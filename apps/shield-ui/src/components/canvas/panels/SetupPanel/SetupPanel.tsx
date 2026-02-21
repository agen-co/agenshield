/**
 * SetupPanel — left-side panel for initial setup and add-profile flows.
 *
 * Two modes:
 * - **CLI setup mode** (`serverMode === 'setup'`): Uses wizard engine SSE for
 *   real-time step progress. Shows all wizard steps grouped by phase. Action
 *   buttons map to wizard API calls (configure, confirm, passcode).
 * - **Daemon mode**: Uses setupPanelStore + daemon endpoints. Shows simplified
 *   4-step flow: Detection → Configure → Shielding → Complete.
 */

import { useState, useCallback, useEffect } from 'react';
import { useSnapshot } from 'valtio';
import { X, Zap, Shield } from 'lucide-react';
import { useTheme } from '@mui/material/styles';
import type { DetectedTarget, OldInstallation } from '@agenshield/ipc';
import type { SetupPanelProps, SetupStep, ShieldProgressEntry } from './SetupPanel.types';
import {
  PanelRoot,
  PanelHeader,
  PanelTitle,
  PanelSubtitle,
  PanelBody,
  StepIndicator,
  StepDot,
  StepLabel,
} from './SetupPanel.styles';
import { DetectionStep } from './steps/DetectionStep';
import { ConfigureStep } from './steps/ConfigureStep';
import { ShieldingStep } from './steps/ShieldingStep';
import { CompleteStep } from './steps/CompleteStep';
import { StateOverviewStep } from './steps/StateOverviewStep';
import { WizardStepList } from './steps/WizardStepList';
import { setupPanelStore, resetSetupPanel, markShieldComplete } from '../../../../state/setup-panel';
import { setupStore, type WizardState } from '../../../../state/setup';
import { useServerMode } from '../../../../api/hooks';
import { useSetupSSE, useConfigure, useConfirmSetup, useSetPasscode } from '../../../../api/setup';

const STEPS: { id: SetupStep; label: string }[] = [
  { id: 'detection', label: 'Detect' },
  { id: 'configure', label: 'Configure' },
  { id: 'shielding', label: 'Shield' },
  { id: 'complete', label: 'Complete' },
];

export function SetupPanel({ open, onClose, mode }: SetupPanelProps) {
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';

  const serverMode = useServerMode();
  const isCliSetup = serverMode === 'setup';

  const panelState = useSnapshot(setupPanelStore);
  const wizardSnap = useSnapshot(setupStore);

  // Connect to wizard SSE in CLI setup mode
  useSetupSSE(isCliSetup);

  // Wizard API mutations (CLI setup mode)
  const configure = useConfigure();
  const confirmSetup = useConfirmSetup();
  const setPasscode = useSetPasscode();

  // --- Daemon mode state ---
  const [currentStep, setCurrentStep] = useState<SetupStep>('state-overview');
  const [selectedTargetId, setSelectedTargetId] = useState<string | null>(null);

  // Reset state when panel opens; check for pre-selected target
  useEffect(() => {
    if (open && !isCliSetup) {
      const preSelected = setupPanelStore.preSelectedTargetId;
      if (preSelected) {
        setSelectedTargetId(preSelected);
        setCurrentStep('configure');
        setupPanelStore.preSelectedTargetId = null;
      } else {
        setCurrentStep('state-overview');
        setSelectedTargetId(null);
        resetSetupPanel();
      }
    }
  }, [open, isCliSetup]);

  // Watch for shield completion via SSE events in the store (daemon mode)
  useEffect(() => {
    if (!isCliSetup && selectedTargetId && panelState.shieldProgress[selectedTargetId]?.status === 'completed') {
      setCurrentStep('complete');
    }
  }, [isCliSetup, selectedTargetId, panelState.shieldProgress]);

  // --- Daemon mode handlers ---
  const handleSelectTarget = useCallback((targetId: string) => {
    setSelectedTargetId(targetId);
    setCurrentStep('configure');
  }, []);

  const handleShield = useCallback(async () => {
    if (!selectedTargetId) return;
    setCurrentStep('shielding');

    try {
      const res = await fetch(`/api/setup/shield/${selectedTargetId}`, { method: 'POST' });
      if (!res.ok) {
        console.error('[SetupPanel] Shield failed:', await res.text());
        return;
      }
      const json = await res.json();
      if (json.success && json.data?.profileId) {
        // Use HTTP response as fallback — SSE may have already advanced,
        // but if not, ensure the store is updated and step advances.
        markShieldComplete(selectedTargetId, json.data.profileId);
      }
    } catch (err) {
      console.error('[SetupPanel] Shield request failed:', err);
    }
  }, [selectedTargetId]);

  const handleComplete = useCallback(async () => {
    if (mode === 'initial-setup') {
      try {
        await fetch('/api/setup/complete', { method: 'POST' });
      } catch (err) {
        console.error('[SetupPanel] Complete request failed:', err);
      }
    }
    onClose();
  }, [mode, onClose]);

  const handleAddAnother = useCallback(() => {
    setCurrentStep('state-overview');
    setSelectedTargetId(null);
  }, []);

  const handleRefresh = useCallback(async () => {
    setupPanelStore.isDetecting = true;
    try {
      const res = await fetch('/api/setup/detection');
      const data = await res.json();
      if (data.success) {
        setupPanelStore.detectedTargets = data.data.targets;
        setupPanelStore.oldInstallations = data.data.oldInstallations;
      }
    } catch (err) {
      console.error('[SetupPanel] Detection failed:', err);
    } finally {
      setupPanelStore.isDetecting = false;
    }
  }, []);

  // Auto-detect on first open (daemon mode only)
  useEffect(() => {
    if (open && !isCliSetup && panelState.detectedTargets.length === 0 && !panelState.isDetecting) {
      handleRefresh();
    }
  }, [open, isCliSetup]);

  // --- CLI setup mode handlers ---
  const handleCliStartSetup = useCallback(async () => {
    try {
      await configure.mutateAsync({ mode: 'quick' });
      await confirmSetup.mutateAsync();
    } catch (err) {
      console.error('[SetupPanel] CLI setup start failed:', err);
    }
  }, [configure, confirmSetup]);

  const handleCliSetPasscode = useCallback(async (passcode: string) => {
    try {
      await setPasscode.mutateAsync({ passcode });
    } catch (err) {
      console.error('[SetupPanel] CLI passcode failed:', err);
    }
  }, [setPasscode]);

  const handleCliSkipPasscode = useCallback(async () => {
    try {
      await setPasscode.mutateAsync({ skip: true });
    } catch (err) {
      console.error('[SetupPanel] CLI skip passcode failed:', err);
    }
  }, [setPasscode]);

  // --- Render ---
  const stepIndex = STEPS.findIndex((s) => s.id === currentStep);
  const selectedTarget = !isCliSetup
    ? (panelState.detectedTargets as DetectedTarget[]).find((t) => t.id === selectedTargetId) ?? null
    : null;
  const shieldProgress = !isCliSetup && selectedTargetId
    ? (panelState.shieldProgress[selectedTargetId] as ShieldProgressEntry | undefined) ?? null
    : null;

  return (
    <PanelRoot $open={open}>
      {/* Branding header (setup mode — sidebar is hidden) */}
      {mode === 'initial-setup' && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '12px 16px 0',
          fontFamily: "'IBM Plex Mono', monospace",
        }}>
          <Shield size={18} color={isDark ? '#C0C0C0' : '#333'} />
          <span style={{
            fontWeight: 700,
            fontSize: 14,
            letterSpacing: 1,
            textTransform: 'uppercase',
            color: theme.palette.text.primary,
          }}>
            AgenShield
          </span>
        </div>
      )}

      {/* Header */}
      <PanelHeader>
        <div>
          <PanelTitle style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Zap size={14} color={isDark ? '#C0C0C0' : '#333'} />
            {mode === 'initial-setup' ? 'System Setup' : 'Add Target'}
          </PanelTitle>
          <PanelSubtitle>
            {isCliSetup
              ? 'Installing and configuring AgenShield'
              : mode === 'initial-setup'
                ? 'Detect and shield targets on this system'
                : 'Shield a new target with AgenShield'
            }
          </PanelSubtitle>
        </div>
        {mode !== 'initial-setup' && (
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: theme.palette.text.secondary,
              padding: 4,
              display: 'flex',
            }}
          >
            <X size={16} />
          </button>
        )}
      </PanelHeader>

      {/* Step indicator — CLI setup shows phase progress, daemon shows 4-step flow.
          Skipped on state-overview (landing page, not a wizard step). */}
      {!isCliSetup && currentStep !== 'state-overview' && (
        <StepIndicator>
          {STEPS.map((step, i) => (
            <div key={step.id} style={{ display: 'flex', alignItems: 'center' }}>
              <StepDot $active={i === stepIndex} $completed={i < stepIndex} />
              <StepLabel $active={i === stepIndex}>{step.label}</StepLabel>
            </div>
          ))}
        </StepIndicator>
      )}

      {/* Body */}
      <PanelBody>
        {isCliSetup ? (
          /* === CLI setup mode: wizard step list === */
          <WizardStepList
            wizardState={wizardSnap.wizardState as WizardState | null}
            stepLogs={wizardSnap.stepLogs as Record<string, string>}
            phase={wizardSnap.phase}
            onStartSetup={handleCliStartSetup}
            onSetPasscode={handleCliSetPasscode}
            onSkipPasscode={handleCliSkipPasscode}
            isStarting={configure.isPending || confirmSetup.isPending}
            isSettingPasscode={setPasscode.isPending}
          />
        ) : (
          /* === Daemon mode: state-first flow === */
          <>
            {currentStep === 'state-overview' && (
              <StateOverviewStep
                targets={panelState.detectedTargets as DetectedTarget[]}
                isLoading={panelState.isDetecting}
                onSelectTarget={handleSelectTarget}
                onScanTargets={() => setCurrentStep('detection')}
                onAddManual={() => setCurrentStep('detection')}
              />
            )}
            {currentStep === 'detection' && (
              <DetectionStep
                targets={panelState.detectedTargets as DetectedTarget[]}
                oldInstallations={panelState.oldInstallations as OldInstallation[]}
                isLoading={panelState.isDetecting}
                onRefresh={handleRefresh}
                onSelectTarget={handleSelectTarget}
                selectedTargetId={selectedTargetId}
              />
            )}
            {currentStep === 'configure' && (
              <ConfigureStep
                target={selectedTarget}
                onBack={() => setCurrentStep('state-overview')}
                onShield={handleShield}
              />
            )}
            {currentStep === 'shielding' && selectedTargetId && (
              <ShieldingStep
                targetId={selectedTargetId}
                progress={shieldProgress}
              />
            )}
            {currentStep === 'complete' && (
              <CompleteStep
                mode={mode}
                onComplete={handleComplete}
                onAddAnother={handleAddAnother}
              />
            )}
          </>
        )}
      </PanelBody>
    </PanelRoot>
  );
}
