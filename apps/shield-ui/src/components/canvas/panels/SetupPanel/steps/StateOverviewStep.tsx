/**
 * StateOverviewStep — initial landing view showing current system state.
 *
 * Displays detected targets grouped by shield status with actionable cards.
 * Shielded targets show as read-only with green check; unshielded targets
 * are clickable to enter the configure flow.
 */

import { Shield, Search, Plus, Terminal, Globe, Monitor, CheckCircle } from 'lucide-react';
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

  const shieldedTargets = targets.filter((t) => t.shielded);
  const unshieldedTargets = targets.filter((t) => !t.shielded);
  const hasTargets = targets.length > 0;

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
          {shieldedTargets.length}/{targets.length} targets shielded
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

      {/* Shielded targets — read-only */}
      {shieldedTargets.length > 0 && (
        <>
          <SectionTitle style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: unshieldedTargets.length > 0 ? 16 : 0 }}>
            <CheckCircle size={12} color="#6CB685" />
            Shielded
          </SectionTitle>
          {shieldedTargets.map((target) => {
            const Icon = presetIcons[target.type] ?? Terminal;
            return (
              <TargetCard
                key={target.id}
                $selected={false}
                style={{ cursor: 'default', opacity: 0.7 }}
              >
                <TargetIcon style={{ backgroundColor: 'rgba(108,182,133,0.12)' }}>
                  <Icon size={18} color="#6CB685" />
                </TargetIcon>
                <TargetInfo>
                  <TargetName>{target.name}</TargetName>
                  <TargetMeta>
                    {target.version && `v${target.version} · `}
                    {target.method}
                  </TargetMeta>
                </TargetInfo>
                <ShieldedBadge>Shielded</ShieldedBadge>
              </TargetCard>
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
