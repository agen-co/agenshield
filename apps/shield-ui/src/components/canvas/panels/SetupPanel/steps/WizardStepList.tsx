/**
 * WizardStepList — CLI setup mode step display.
 *
 * Shows all wizard engine steps grouped by phase with live status indicators.
 * Each step shows: dot indicator (completed/running/pending/error/skipped),
 * step name, and streaming log line.
 */

import { useState, useCallback } from 'react';
import { Check, Loader, Circle, AlertCircle, SkipForward, Lock } from 'lucide-react';
import { useTheme } from '@mui/material/styles';
import type { WizardState, WizardStep } from '../../../../../state/setup';
import type { SetupPhase } from '../../../../../state/setup';
import { WIZARD_PHASES } from '../SetupPanel.types';
import {
  SectionTitle,
  ActionButton,
  SecondaryButton,
} from '../SetupPanel.styles';

interface WizardStepListProps {
  wizardState: WizardState | null;
  stepLogs: Record<string, string>;
  phase: SetupPhase;
  onStartSetup: () => void;
  onSetPasscode: (passcode: string) => void;
  onSkipPasscode: () => void;
  isStarting: boolean;
  isSettingPasscode: boolean;
}

function StepStatusIcon({ status }: { status: WizardStep['status'] }) {
  switch (status) {
    case 'completed':
      return <Check size={12} color="#6CB685" strokeWidth={2.5} />;
    case 'running':
      return <Loader size={12} style={{ animation: 'spin 1.5s linear infinite' }} />;
    case 'error':
      return <AlertCircle size={12} color="#E1583E" />;
    case 'skipped':
      return <SkipForward size={10} color="#888" />;
    default:
      return <Circle size={8} color="rgba(128,128,128,0.3)" />;
  }
}

export function WizardStepList({
  wizardState,
  stepLogs,
  phase,
  onStartSetup,
  onSetPasscode,
  onSkipPasscode,
  isStarting,
  isSettingPasscode,
}: WizardStepListProps) {
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';

  const [passcode, setPasscode] = useState('');

  const handlePasscodeSubmit = useCallback(() => {
    if (passcode.length >= 4) {
      onSetPasscode(passcode);
    }
  }, [passcode, onSetPasscode]);

  // Build a step lookup from wizard state
  const stepMap = new Map<string, WizardStep>();
  if (wizardState?.steps) {
    for (const step of wizardState.steps) {
      stepMap.set(step.id, step);
    }
  }

  // Before wizard state arrives, show "waiting" state
  if (!wizardState) {
    return (
      <div style={{ textAlign: 'center', padding: '32px 0' }}>
        <Loader size={24} style={{ animation: 'spin 2s linear infinite', opacity: 0.5 }} />
        <div style={{ marginTop: 12, fontSize: 12, opacity: 0.6 }}>
          Connecting to setup engine...
        </div>
      </div>
    );
  }

  // Show "Start Setup" when the confirm step hasn't completed and nothing is actively running
  const confirmStep = wizardState.steps.find((s) => s.id === 'confirm');
  const needsConfirm = confirmStep && confirmStep.status === 'pending';
  const isExecuting = wizardState.steps.some((s) => s.status === 'running');

  // Passcode phase
  if (phase === 'passcode') {
    return (
      <div style={{ padding: '8px 0' }}>
        <SectionTitle style={{ fontSize: 14, marginBottom: 12 }}>
          Set Passcode
        </SectionTitle>
        <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 16 }}>
          Protect your AgenShield dashboard with a passcode.
        </div>
        <div style={{ marginBottom: 12 }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '8px 12px',
            borderRadius: 6,
            border: `1px solid ${isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.15)'}`,
            backgroundColor: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.02)',
          }}>
            <Lock size={14} color={isDark ? '#888' : '#666'} />
            <input
              type="password"
              placeholder="Enter passcode (4+ chars)"
              value={passcode}
              onChange={(e) => setPasscode(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handlePasscodeSubmit()}
              style={{
                flex: 1,
                border: 'none',
                background: 'none',
                outline: 'none',
                color: theme.palette.text.primary,
                fontSize: 13,
                fontFamily: "'IBM Plex Mono', monospace",
              }}
            />
          </div>
        </div>
        <ActionButton
          onClick={handlePasscodeSubmit}
          disabled={passcode.length < 4 || isSettingPasscode}
          style={{ marginBottom: 8 }}
        >
          {isSettingPasscode ? 'Setting...' : 'Set Passcode'}
        </ActionButton>
        <SecondaryButton onClick={onSkipPasscode} disabled={isSettingPasscode}>
          Skip
        </SecondaryButton>
      </div>
    );
  }

  // Complete phase
  if (phase === 'complete') {
    return (
      <div style={{ textAlign: 'center', padding: '32px 0' }}>
        <Check size={32} color="#6CB685" style={{ marginBottom: 12 }} />
        <SectionTitle style={{ fontSize: 16, marginBottom: 4 }}>
          Setup Complete
        </SectionTitle>
        <div style={{ fontSize: 12, opacity: 0.6 }}>
          AgenShield is installed and protecting your system.
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* Start button (before confirm step completes and nothing running) */}
      {needsConfirm && !isExecuting && (
        <div style={{ marginBottom: 16 }}>
          <ActionButton onClick={onStartSetup} disabled={isStarting}>
            {isStarting ? 'Starting...' : 'Start Setup'}
          </ActionButton>
        </div>
      )}

      {/* Phase groups with step lists */}
      {WIZARD_PHASES.map((phaseConfig) => {
        const phaseSteps = phaseConfig.stepIds
          .map((id) => stepMap.get(id))
          .filter((s): s is WizardStep => !!s);

        // Don't show empty phases
        if (phaseSteps.length === 0) return null;

        // Determine phase-level status
        const allCompleted = phaseSteps.every((s) => s.status === 'completed' || s.status === 'skipped');
        const anyRunning = phaseSteps.some((s) => s.status === 'running');
        const anyError = phaseSteps.some((s) => s.status === 'error');

        const phaseColor = allCompleted
          ? '#6CB685'
          : anyError
            ? '#E1583E'
            : anyRunning
              ? (isDark ? '#C0C0C0' : '#333')
              : (isDark ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.2)');

        return (
          <div key={phaseConfig.id} style={{ marginBottom: 16 }}>
            {/* Phase header */}
            <div style={{
              fontSize: 10,
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: 1,
              color: phaseColor,
              marginBottom: 6,
              fontFamily: "'IBM Plex Mono', monospace",
            }}>
              {phaseConfig.label}
            </div>

            {/* Step rows */}
            {phaseSteps.map((step) => {
              const logLine = stepLogs[step.id];
              const isActive = step.status === 'running';

              return (
                <div
                  key={step.id}
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 8,
                    padding: '3px 0',
                    opacity: step.status === 'pending' ? 0.4 : 1,
                    transition: 'opacity 0.3s',
                  }}
                >
                  {/* Status icon */}
                  <div style={{
                    width: 16,
                    height: 16,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                    marginTop: 1,
                  }}>
                    <StepStatusIcon status={step.status} />
                  </div>

                  {/* Step info */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      fontSize: 11,
                      fontWeight: isActive ? 600 : 400,
                      color: theme.palette.text.primary,
                      lineHeight: 1.3,
                    }}>
                      {step.name}
                    </div>
                    {/* Streaming log line (only for active step) */}
                    {isActive && logLine && (
                      <div style={{
                        fontSize: 9,
                        color: theme.palette.text.secondary,
                        marginTop: 2,
                        fontFamily: "'IBM Plex Mono', monospace",
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}>
                        {logLine}
                      </div>
                    )}
                    {/* Error message */}
                    {step.status === 'error' && step.error && (
                      <div style={{
                        fontSize: 9,
                        color: '#E1583E',
                        marginTop: 2,
                        fontFamily: "'IBM Plex Mono', monospace",
                      }}>
                        {step.error}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
