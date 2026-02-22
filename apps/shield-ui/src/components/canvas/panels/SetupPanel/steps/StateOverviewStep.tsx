/**
 * StateOverviewStep — initial landing view showing current system state.
 *
 * Displays detected targets grouped by shield status with actionable cards.
 * Shielded targets show action buttons (Start/Stop/Unshield); unshielded
 * targets are clickable to enter the configure flow.
 */

import { useState } from 'react';
import { Shield, Search, Plus, Terminal, Globe, Monitor, CheckCircle, Play, Square, ShieldOff } from 'lucide-react';
import { useTheme } from '@mui/material/styles';
import type { StateOverviewStepProps } from '../SetupPanel.types';
import {
  SectionTitle,
  TargetCard,
  TargetIcon,
  TargetInfo,
  TargetName,
  TargetMeta,
  EmptyText,
  ActionButton,
  SecondaryButton,
  ShieldedBadge,
} from '../SetupPanel.styles';
import {
  useTargets,
  useShieldTarget,
  useUnshieldTarget,
  useStartTarget,
  useStopTarget,
} from '../../../../../api/targets';

const presetIcons: Record<string, typeof Terminal> = {
  'claude-code': Terminal,
  'openclaw': Globe,
  'cursor': Monitor,
};

export function StateOverviewStep({
  targets,
  isLoading,
  onSelectTarget,
  onScanTargets,
  onAddManual,
}: StateOverviewStepProps) {
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';

  // Target lifecycle hooks
  const { data: lifecycleData } = useTargets();
  const shieldTarget = useShieldTarget();
  const unshieldTarget = useUnshieldTarget();
  const startTarget = useStartTarget();
  const stopTarget = useStopTarget();

  const [actionInProgress, setActionInProgress] = useState<string | null>(null);

  // Merge lifecycle data (running status) with detected targets
  const lifecycleTargets = lifecycleData?.data ?? [];
  const enrichedTargets = targets.map((t) => {
    const lifecycle = lifecycleTargets.find((lt) => lt.id === t.id);
    return { ...t, running: lifecycle?.running ?? false };
  });

  const shieldedTargets = enrichedTargets.filter((t) => t.shielded);
  const unshieldedTargets = enrichedTargets.filter((t) => !t.shielded);
  const hasTargets = enrichedTargets.length > 0;

  const handleAction = async (action: 'start' | 'stop' | 'unshield' | 'shield', targetId: string) => {
    setActionInProgress(`${action}-${targetId}`);
    try {
      switch (action) {
        case 'start':
          await startTarget.mutateAsync(targetId);
          break;
        case 'stop':
          await stopTarget.mutateAsync(targetId);
          break;
        case 'unshield':
          await unshieldTarget.mutateAsync(targetId);
          break;
        case 'shield':
          await shieldTarget.mutateAsync({ targetId });
          break;
      }
    } catch (err) {
      console.error(`[StateOverview] ${action} failed:`, err);
    } finally {
      setActionInProgress(null);
    }
  };

  const isActioning = (action: string, targetId: string) =>
    actionInProgress === `${action}-${targetId}`;

  return (
    <>
      {/* Summary line */}
      {hasTargets && (
        <div style={{
          fontSize: 11,
          color: theme.palette.text.secondary,
          marginBottom: 14,
          fontFamily: "'IBM Plex Mono', monospace",
        }}>
          {shieldedTargets.length}/{enrichedTargets.length} targets shielded
        </div>
      )}

      {/* No targets state */}
      {!hasTargets && !isLoading && (
        <EmptyText>
          <Search size={24} style={{ opacity: 0.3, display: 'block', margin: '0 auto 8px' }} />
          No targets detected
          <br />
          <span style={{ fontSize: 10 }}>Scan for targets or add one manually.</span>
        </EmptyText>
      )}

      {isLoading && !hasTargets && (
        <EmptyText>
          <Search size={24} style={{ opacity: 0.3, display: 'block', margin: '0 auto 8px', animation: 'spin 1s linear infinite' }} />
          Scanning for targets...
        </EmptyText>
      )}

      {/* Unshielded targets — clickable */}
      {unshieldedTargets.length > 0 && (
        <>
          <SectionTitle style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <Shield size={12} color={isDark ? '#999' : '#666'} />
            Unshielded
          </SectionTitle>
          {unshieldedTargets.map((target) => {
            const Icon = presetIcons[target.type] ?? Terminal;
            return (
              <TargetCard
                key={target.id}
                $selected={false}
                onClick={() => onSelectTarget(target.id)}
                style={{ cursor: 'pointer' }}
              >
                <TargetIcon>
                  <Icon size={18} color={isDark ? '#999' : '#666'} />
                </TargetIcon>
                <TargetInfo>
                  <TargetName>{target.name}</TargetName>
                  <TargetMeta>
                    {target.version && `v${target.version} · `}
                    {target.method}
                    {target.binaryPath && ` · ${target.binaryPath}`}
                  </TargetMeta>
                </TargetInfo>
                <span style={{
                  fontSize: 9,
                  fontWeight: 600,
                  color: '#E1583E',
                  textTransform: 'uppercase',
                  letterSpacing: 0.5,
                }}>
                  Shield
                </span>
              </TargetCard>
            );
          })}
        </>
      )}

      {/* Shielded targets — with action buttons */}
      {shieldedTargets.length > 0 && (
        <>
          <SectionTitle style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: unshieldedTargets.length > 0 ? 16 : 0 }}>
            <CheckCircle size={12} color="#6CB685" />
            Shielded
          </SectionTitle>
          {shieldedTargets.map((target) => {
            const Icon = presetIcons[target.type] ?? Terminal;
            return (
              <div key={target.id}>
                <TargetCard $selected={false} style={{ cursor: 'default' }}>
                  <TargetIcon style={{ backgroundColor: 'rgba(108,182,133,0.12)' }}>
                    <Icon size={18} color="#6CB685" />
                  </TargetIcon>
                  <TargetInfo>
                    <TargetName>{target.name}</TargetName>
                    <TargetMeta>
                      {target.version && `v${target.version}`}
                      {target.running
                        ? <span style={{ color: '#6CB685', marginLeft: 4 }}> Running</span>
                        : <span style={{ color: '#888', marginLeft: 4 }}> Stopped</span>}
                    </TargetMeta>
                  </TargetInfo>
                  <ShieldedBadge>Shielded</ShieldedBadge>
                </TargetCard>
                {/* Action buttons */}
                <div style={{
                  display: 'flex',
                  gap: 6,
                  padding: '4px 0 8px',
                  marginLeft: 36,
                }}>
                  {target.running ? (
                    <button
                      onClick={() => handleAction('stop', target.id)}
                      disabled={!!actionInProgress}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 4,
                        padding: '3px 8px',
                        fontSize: 10,
                        fontWeight: 600,
                        color: isDark ? '#ccc' : '#555',
                        background: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
                        border: `1px solid ${isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.1)'}`,
                        borderRadius: 4,
                        cursor: actionInProgress ? 'not-allowed' : 'pointer',
                        opacity: actionInProgress ? 0.5 : 1,
                      }}
                    >
                      <Square size={9} />
                      {isActioning('stop', target.id) ? 'Stopping...' : 'Stop'}
                    </button>
                  ) : (
                    <button
                      onClick={() => handleAction('start', target.id)}
                      disabled={!!actionInProgress}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 4,
                        padding: '3px 8px',
                        fontSize: 10,
                        fontWeight: 600,
                        color: '#6CB685',
                        background: isDark ? 'rgba(108,182,133,0.08)' : 'rgba(108,182,133,0.06)',
                        border: '1px solid rgba(108,182,133,0.25)',
                        borderRadius: 4,
                        cursor: actionInProgress ? 'not-allowed' : 'pointer',
                        opacity: actionInProgress ? 0.5 : 1,
                      }}
                    >
                      <Play size={9} />
                      {isActioning('start', target.id) ? 'Starting...' : 'Start'}
                    </button>
                  )}
                  <button
                    onClick={() => handleAction('unshield', target.id)}
                    disabled={!!actionInProgress}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 4,
                      padding: '3px 8px',
                      fontSize: 10,
                      fontWeight: 600,
                      color: '#E1583E',
                      background: isDark ? 'rgba(225,88,62,0.08)' : 'rgba(225,88,62,0.04)',
                      border: '1px solid rgba(225,88,62,0.2)',
                      borderRadius: 4,
                      cursor: actionInProgress ? 'not-allowed' : 'pointer',
                      opacity: actionInProgress ? 0.5 : 1,
                    }}
                  >
                    <ShieldOff size={9} />
                    {isActioning('unshield', target.id) ? 'Removing...' : 'Unshield'}
                  </button>
                </div>
              </div>
            );
          })}
        </>
      )}

      {/* Actions */}
      <div style={{ marginTop: 20, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <ActionButton onClick={onScanTargets}>
          <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
            <Search size={13} />
            Scan for Targets
          </span>
        </ActionButton>
        <SecondaryButton onClick={onAddManual}>
          <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
            <Plus size={13} />
            Add Target Manually
          </span>
        </SecondaryButton>
      </div>
    </>
  );
}
