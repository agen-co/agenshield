/**
 * SetupPanel — left-side panel for initial setup and add-profile flows.
 *
 * Shows a simplified 4-step flow:
 * State Overview → Detection → Configure → Shielding → Complete.
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
import { ScanResultsStep } from './steps/ScanResultsStep';
import { setupPanelStore, resetSetupPanel, markShieldComplete, mergeDetectedTargets } from '../../../../state/setup-panel';
import { authFetch } from '../../../../api/client';
import { useTargets } from '../../../../api/targets';
import { useIsShielding } from '../../../../hooks/useIsShielding';

const STEPS: { id: SetupStep; label: string }[] = [
  { id: 'scan-results', label: 'Targets' },
  { id: 'configure', label: 'Configure' },
  { id: 'shielding', label: 'Shield' },
  { id: 'complete', label: 'Complete' },
];

export function SetupPanel({ open, onClose, mode }: SetupPanelProps) {
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';
  const panelState = useSnapshot(setupPanelStore);
  const shielding = useIsShielding();

  const [currentStep, setCurrentStep] = useState<SetupStep>('state-overview');
  const [selectedTargetId, setSelectedTargetId] = useState<string | null>(null);
  const [shieldError, setShieldError] = useState<string | null>(null);

  // Target list is now SSE-driven — refetch used for explicit refresh after operations
  const { refetch: refetchTargets } = useTargets();

  // Reset state when panel opens; check for pre-selected target or passcode setup
  useEffect(() => {
    if (open) {
      const preSelected = setupPanelStore.preSelectedTargetId;
      if (preSelected) {
        setSelectedTargetId(preSelected);
        // Check shielding status: show progress if in-progress, complete if done
        const entry = setupPanelStore.shieldProgress[preSelected];
        if (entry?.status === 'in_progress') {
          setCurrentStep('shielding');
        } else if (entry?.status === 'completed') {
          setCurrentStep('complete');
        } else {
          setCurrentStep('configure');
        }
        setupPanelStore.preSelectedTargetId = null;
      } else {
        setCurrentStep('state-overview');
        setSelectedTargetId(null);
        resetSetupPanel();
      }
    }
  }, [open, mode]);

  // Watch for shield completion via SSE events in the store
  useEffect(() => {
    if (!selectedTargetId) return;
    const entry = panelState.shieldProgress[selectedTargetId];
    if (entry?.status === 'completed') {
      setCurrentStep('complete');
    } else if (entry?.status === 'error') {
      setShieldError(entry.message ?? 'Shield operation failed');
      setCurrentStep('configure');
    }
  }, [selectedTargetId, panelState.shieldProgress]);

  const handleSelectTarget = useCallback((targetId: string) => {
    setSelectedTargetId(targetId);
    const entry = setupPanelStore.shieldProgress[targetId];
    if (entry?.status === 'in_progress') {
      setCurrentStep('shielding');
    } else if (entry?.status === 'completed') {
      setCurrentStep('complete');
    } else {
      setCurrentStep('configure');
    }
  }, []);

  const handleShield = useCallback(async (baseName?: string, version?: string) => {
    if (!selectedTargetId) return;
    setShieldError(null);
    setCurrentStep('shielding');

    try {
      const res = await authFetch(`/api/targets/lifecycle/${selectedTargetId}/shield`, {
        method: 'POST',
        body: JSON.stringify({ baseName, openclawVersion: version }),
      });
      if (!res.ok) {
        let errorMsg = 'Shield operation failed';
        try {
          const body = await res.json();
          errorMsg = body.error?.message ?? errorMsg;
          if (body.error?.step) errorMsg += ` (step: ${body.error.step})`;
        } catch { /* fallback to generic message */ }
        setShieldError(errorMsg);
        setCurrentStep('configure');
        return;
      }
      const json = await res.json();
      if (json.success && json.data?.profileId) {
        markShieldComplete(selectedTargetId, json.data.profileId);
      }
    } catch (err) {
      setShieldError((err as Error).message || 'Network error');
      setCurrentStep('configure');
    }
  }, [selectedTargetId]);

  const handleComplete = useCallback(async () => {
    // Refresh target list so the canvas updates
    refetchTargets();
    onClose();
  }, [onClose, refetchTargets]);

  const handleAddAnother = useCallback(() => {
    setCurrentStep(mode === 'initial-setup' ? 'scan-results' : 'state-overview');
    setSelectedTargetId(null);
  }, [mode]);

  const handleRefresh = useCallback(async () => {
    setupPanelStore.isDetecting = true;
    try {
      const res = await authFetch('/api/targets/lifecycle/detect', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        mergeDetectedTargets(data.data);
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
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // --- Render ---
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

      {/* Step indicator — hidden during passcode, scan-results, and state-overview steps */}
      {currentStep !== 'state-overview' && currentStep !== 'scan-results' && (
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
        {currentStep === 'scan-results' && (
          <ScanResultsStep
            targets={panelState.detectedTargets as DetectedTarget[]}
            isLoading={panelState.isDetecting}
            onSelectTarget={handleSelectTarget}
            onRescan={handleRefresh}
          />
        )}
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
            onBack={() => setCurrentStep(mode === 'initial-setup' ? 'scan-results' : 'state-overview')}
            onShield={handleShield}
            error={shieldError}
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
