/**
 * SetupPanel — left-side panel for initial setup and add-profile flows.
 *
 * Contains a step-based wizard: Detection -> Configure -> Shielding -> Complete.
 * Lives as a fixed overlay on the canvas page.
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
import { setupPanelStore, resetSetupPanel } from '../../../../state/setup-panel';

const STEPS: { id: SetupStep; label: string }[] = [
  { id: 'detection', label: 'Detect' },
  { id: 'configure', label: 'Configure' },
  { id: 'shielding', label: 'Shield' },
  { id: 'complete', label: 'Complete' },
];

export function SetupPanel({ open, onClose, mode }: SetupPanelProps) {
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';

  const panelState = useSnapshot(setupPanelStore);

  const [currentStep, setCurrentStep] = useState<SetupStep>('detection');
  const [selectedTargetId, setSelectedTargetId] = useState<string | null>(null);

  // Reset state when panel opens
  useEffect(() => {
    if (open) {
      setCurrentStep('detection');
      setSelectedTargetId(null);
      resetSetupPanel();
    }
  }, [open]);

  // Watch for shield completion via SSE events in the store
  useEffect(() => {
    if (selectedTargetId && panelState.shieldProgress[selectedTargetId]?.status === 'completed') {
      setCurrentStep('complete');
    }
  }, [selectedTargetId, panelState.shieldProgress]);

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
    setCurrentStep('detection');
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

  // Auto-detect on first open
  useEffect(() => {
    if (open && panelState.detectedTargets.length === 0 && !panelState.isDetecting) {
      handleRefresh();
    }
  }, [open]);

  const stepIndex = STEPS.findIndex((s) => s.id === currentStep);
  const selectedTarget = (panelState.detectedTargets as DetectedTarget[]).find((t) => t.id === selectedTargetId) ?? null;
  const shieldProgress = selectedTargetId
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
            {mode === 'initial-setup'
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

      {/* Step indicator */}
      <StepIndicator>
        {STEPS.map((step, i) => (
          <div key={step.id} style={{ display: 'flex', alignItems: 'center' }}>
            <StepDot $active={i === stepIndex} $completed={i < stepIndex} />
            <StepLabel $active={i === stepIndex}>{step.label}</StepLabel>
          </div>
        ))}
      </StepIndicator>

      {/* Body — current step */}
      <PanelBody>
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
            onBack={() => setCurrentStep('detection')}
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
      </PanelBody>
    </PanelRoot>
  );
}
