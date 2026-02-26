/**
 * SystemPanel — persistent left-side panel on the canvas.
 *
 * Two modes:
 *   - **status** (default): Daemon info, shielded targets, active operations, security.
 *   - **setup**: Shielding wizard (Targets → Configure → Shield → Complete).
 *
 * Always visible when the canvas is in idle zoom phase.
 * Auth-gated actions: "Shield New Target" and target actions require authentication.
 */

import { useState, useCallback, useEffect } from 'react';
import { useSnapshot } from 'valtio';
import { useTheme } from '@mui/material/styles';
import { Plus, ArrowLeft } from 'lucide-react';
import type { DetectedTarget, OldInstallation } from '@agenshield/ipc';
import { useStatus } from '../../../../api/hooks';
import { useSecurity } from '../../../../api/hooks';
import { useProfiles } from '../../../../api/hooks';
import { eventStore } from '../../../../state/events';
import { setupPanelStore, resetSetupPanel, markShieldComplete, mergeDetectedTargets } from '../../../../state/setup-panel';
import { authFetch } from '../../../../api/client';
import { useTargets } from '../../../../api/targets';
import type { SystemPanelProps, SystemPanelMode } from './SystemPanel.types';
import type { ShieldProgressEntry } from '../../../../state/setup-panel';
import {
  PanelRoot,
  SectionCard,
  SectionTitle,
  MetricRow,
  MetricLabel,
  MetricValue,
  StatusDot,
  TargetRow,
  TargetName,
  TargetStatus,
  MiniProgress,
  MiniProgressFill,
  ViewDetailsButton,
  ShieldButton,
  SetupHeader,
  BackButton,
  SetupBody,
  StepIndicator,
  StepDot,
  StepLabel,
} from './SystemPanel.styles';

// Setup step components — reused from SetupPanel
import { ScanResultsStep } from '../SetupPanel/steps/ScanResultsStep';
import { ConfigureStep } from '../SetupPanel/steps/ConfigureStep';
import { ShieldingStep } from '../SetupPanel/steps/ShieldingStep';
import { CompleteStep } from '../SetupPanel/steps/CompleteStep';

type SetupStep = 'scan-results' | 'configure' | 'shielding' | 'complete';

const SETUP_STEPS: { id: SetupStep; label: string }[] = [
  { id: 'scan-results', label: 'Targets' },
  { id: 'configure', label: 'Configure' },
  { id: 'shielding', label: 'Shield' },
  { id: 'complete', label: 'Complete' },
];

function formatUptime(seconds?: number): string {
  if (!seconds) return '--';
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  const remMins = mins % 60;
  return remMins > 0 ? `${hrs}h ${remMins}m` : `${hrs}h`;
}

function levelToColor(level?: string): string {
  if (level === 'secure') return '#6CB685';
  if (level === 'partial') return '#EEA45F';
  if (level === 'critical') return '#E1583E';
  return '#E1583E'; // unprotected
}

function levelToLabel(level?: string): string {
  if (!level) return 'Unknown';
  return level.charAt(0).toUpperCase() + level.slice(1);
}

export function SystemPanel({ open, onShieldComplete }: SystemPanelProps) {
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';

  // Panel mode
  const [mode, setMode] = useState<SystemPanelMode>('status');

  // Setup flow state
  const [currentStep, setCurrentStep] = useState<SetupStep>('scan-results');
  const [selectedTargetId, setSelectedTargetId] = useState<string | null>(null);
  const [shieldError, setShieldError] = useState<string | null>(null);

  // Data sources
  const { data: statusData } = useStatus();
  const { data: securityData } = useSecurity();
  const { data: profilesData } = useProfiles();
  const { connected } = useSnapshot(eventStore);
  const panelState = useSnapshot(setupPanelStore);
  const { refetch: refetchTargets } = useTargets();

  const daemon = statusData?.data;
  const sec = securityData?.data;
  const profiles = profilesData?.data ?? [];

  // Find active shielding operations
  const activeOps = Object.entries(panelState.shieldProgress)
    .filter(([, entry]) => entry.status === 'in_progress')
    .map(([targetId, entry]) => ({ targetId, ...entry }));

  // Watch preSelectedTargetId to allow external code to trigger setup mode
  useEffect(() => {
    const preSelected = setupPanelStore.preSelectedTargetId;
    if (preSelected) {
      setupPanelStore.preSelectedTargetId = null;
      setSelectedTargetId(preSelected);
      const entry = setupPanelStore.shieldProgress[preSelected];
      if (entry?.status === 'in_progress') {
        setCurrentStep('shielding');
      } else if (entry?.status === 'completed') {
        setCurrentStep('complete');
      } else {
        setCurrentStep('configure');
      }
      setMode('setup');
    }
  }, [panelState.preSelectedTargetId]);

  // Watch for shield completion via SSE
  useEffect(() => {
    if (!selectedTargetId || mode !== 'setup') return;
    const entry = panelState.shieldProgress[selectedTargetId];
    if (entry?.status === 'completed') {
      setCurrentStep('complete');
    } else if (entry?.status === 'error') {
      setShieldError(entry.message ?? 'Shield operation failed');
      setCurrentStep('configure');
    }
  }, [selectedTargetId, panelState.shieldProgress, mode]);

  // Auto-enter setup mode when an active shielding op is detected (e.g. after page refresh)
  useEffect(() => {
    if (mode !== 'status') return;
    const inProgressOp = Object.entries(panelState.shieldProgress)
      .find(([, entry]) => entry.status === 'in_progress');
    if (inProgressOp) {
      const [targetId] = inProgressOp;
      setSelectedTargetId(targetId);
      setCurrentStep('shielding');
      setMode('setup');
    }
  }, [panelState.shieldProgress, mode]);

  // Auto-detect targets on setup mode entry
  useEffect(() => {
    if (mode === 'setup' && (panelState.detectedTargets as DetectedTarget[]).length === 0 && !panelState.isDetecting) {
      handleRefresh();
    }
  }, [mode]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleEnterSetup = useCallback(() => {
    setMode('setup');
    setCurrentStep('scan-results');
    setSelectedTargetId(null);
    setShieldError(null);
    resetSetupPanel();
  }, []);

  const handleBackToStatus = useCallback(() => {
    setMode('status');
    setCurrentStep('scan-results');
    setSelectedTargetId(null);
  }, []);

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

  const handleShield = useCallback(async (baseName?: string, version?: string, configCopyCategories?: string[]) => {
    if (!selectedTargetId) return;
    setShieldError(null);
    setCurrentStep('shielding');

    try {
      const res = await authFetch(`/api/targets/lifecycle/${selectedTargetId}/shield`, {
        method: 'POST',
        body: JSON.stringify({ baseName, openclawVersion: version, configCopyCategories }),
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

  const handleRefresh = useCallback(async () => {
    setupPanelStore.isDetecting = true;
    try {
      const res = await authFetch('/api/targets/lifecycle/detect', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        mergeDetectedTargets(data.data);
      }
    } catch (err) {
      console.error('[SystemPanel] Detection failed:', err);
    } finally {
      setupPanelStore.isDetecting = false;
    }
  }, []);

  const handleComplete = useCallback(async () => {
    refetchTargets();
    setMode('status');
    onShieldComplete?.();
  }, [refetchTargets, onShieldComplete]);

  const handleAddAnother = useCallback(() => {
    setCurrentStep('scan-results');
    setSelectedTargetId(null);
  }, []);

  // Setup mode render
  if (mode === 'setup') {
    const stepIndex = SETUP_STEPS.findIndex((s) => s.id === currentStep);
    const selectedTarget = (panelState.detectedTargets as DetectedTarget[]).find((t) => t.id === selectedTargetId) ?? null;
    const shieldProgress = selectedTargetId
      ? (panelState.shieldProgress[selectedTargetId] as ShieldProgressEntry | undefined) ?? null
      : null;

    return (
      <PanelRoot $open={open}>
        {/* Back header */}
        <SetupHeader>
          <BackButton onClick={handleBackToStatus}>
            <ArrowLeft size={16} />
          </BackButton>
          <div style={{ fontSize: 13, fontWeight: 600 }}>Shield New Target</div>
        </SetupHeader>

        {/* Step indicator */}
        <StepIndicator>
          {SETUP_STEPS.map((step, i) => (
            <div key={step.id} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <StepDot $state={i === stepIndex ? 'active' : i < stepIndex ? 'completed' : 'pending'} />
              <StepLabel $active={i === stepIndex}>{step.label}</StepLabel>
            </div>
          ))}
        </StepIndicator>

        {/* Setup body */}
        <SetupBody>
          {currentStep === 'scan-results' && (
            <ScanResultsStep
              targets={panelState.detectedTargets as DetectedTarget[]}
              isLoading={panelState.isDetecting}
              onSelectTarget={handleSelectTarget}
              onRescan={handleRefresh}
            />
          )}
          {currentStep === 'configure' && (
            <ConfigureStep
              target={selectedTarget}
              onBack={() => setCurrentStep('scan-results')}
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
              mode="add-profile"
              onComplete={handleComplete}
              onAddAnother={handleAddAnother}
            />
          )}
        </SetupBody>
      </PanelRoot>
    );
  }

  // Status mode render
  return (
    <PanelRoot $open={open}>
      {/* Daemon Status */}
      <SectionCard>
        <SectionTitle>Daemon</SectionTitle>
        <MetricRow>
          <MetricLabel>Status</MetricLabel>
          <MetricValue>
            <StatusDot $color={connected ? '#6CB685' : '#E1583E'} />
            {connected ? 'Connected' : 'Disconnected'}
          </MetricValue>
        </MetricRow>
        {daemon && (
          <>
            <MetricRow>
              <MetricLabel>Version</MetricLabel>
              <MetricValue>{daemon.version}</MetricValue>
            </MetricRow>
            <MetricRow>
              <MetricLabel>Uptime</MetricLabel>
              <MetricValue>{formatUptime(daemon.uptime)}</MetricValue>
            </MetricRow>
            {daemon.pid && (
              <MetricRow>
                <MetricLabel>PID</MetricLabel>
                <MetricValue>{daemon.pid}</MetricValue>
              </MetricRow>
            )}
          </>
        )}
      </SectionCard>

      {/* Shielded Targets */}
      <SectionCard>
        <SectionTitle>Shielded Targets</SectionTitle>
        {profiles.length === 0 ? (
          <div style={{
            fontSize: 12,
            color: theme.palette.text.secondary,
            textAlign: 'center',
            padding: '8px 0',
          }}>
            No targets shielded
          </div>
        ) : (
          profiles.map((profile: { id: string; name: string; presetId?: string; agentUsername?: string }) => {
            const progressEntry = panelState.shieldProgress[profile.presetId ?? profile.id];
            const isShielding = progressEntry?.status === 'in_progress';
            return (
              <TargetRow key={profile.id}>
                <StatusDot $color={isShielding ? '#6BAEF2' : '#6CB685'} />
                <TargetName>{profile.name}</TargetName>
                <TargetStatus $variant={isShielding ? 'info' : 'success'}>
                  {isShielding ? 'shielding' : 'shielded'}
                </TargetStatus>
              </TargetRow>
            );
          })
        )}
      </SectionCard>

      {/* Active Operation */}
      {activeOps.length > 0 && (
        <SectionCard>
          <SectionTitle>Active Operation</SectionTitle>
          {activeOps.map((op) => (
            <div key={op.targetId}>
              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
                Shielding {op.targetId}...
              </div>
              <MiniProgress>
                <MiniProgressFill $progress={op.progress} />
              </MiniProgress>
              <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}>
                <span style={{
                  fontSize: 10,
                  color: theme.palette.text.secondary,
                  maxWidth: 150,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}>
                  {op.currentStep ?? 'Preparing...'}
                </span>
                <span style={{
                  fontSize: 10,
                  fontWeight: 600,
                  fontFamily: "'IBM Plex Mono', monospace",
                  color: isDark ? '#6BAEF2' : '#3B82F6',
                }}>
                  {op.progress}%
                </span>
              </div>
              <ViewDetailsButton
                onClick={() => { setupPanelStore.preSelectedTargetId = op.targetId; }}
                style={{ marginTop: 4 }}
              >
                View Details
              </ViewDetailsButton>
            </div>
          ))}
        </SectionCard>
      )}

      {/* Security */}
      <SectionCard>
        <SectionTitle>Security</SectionTitle>
        <MetricRow>
          <MetricLabel>Level</MetricLabel>
          <MetricValue>
            <StatusDot $color={levelToColor(sec?.level)} />
            {levelToLabel(sec?.level)}
          </MetricValue>
        </MetricRow>
        <MetricRow>
          <MetricLabel>Warnings</MetricLabel>
          <MetricValue style={{ color: (sec?.warnings?.length ?? 0) > 0 ? '#EEA45F' : undefined }}>
            {sec?.warnings?.length ?? 0}
          </MetricValue>
        </MetricRow>
        <MetricRow>
          <MetricLabel>Exposed Secrets</MetricLabel>
          <MetricValue style={{ color: (sec?.exposedSecrets?.length ?? 0) > 0 ? '#E1583E' : undefined }}>
            {sec?.exposedSecrets?.length ?? 0}
          </MetricValue>
        </MetricRow>
      </SectionCard>

      {/* Shield New Target */}
      <ShieldButton onClick={handleEnterSetup}>
        <Plus size={14} />
        Shield New Target
      </ShieldButton>
    </PanelRoot>
  );
}
