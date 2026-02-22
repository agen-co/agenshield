/**
 * ScanResultsStep — auto-scan loading + unshielded target list for initial setup.
 *
 * Shows scanning animation while detection is in progress, then displays
 * unshielded detected targets as clickable cards. Each card transitions
 * the user to the configure step for that target.
 */

import { Search, Terminal, Globe, Monitor, RefreshCw, ArrowRight } from 'lucide-react';
import { useTheme } from '@mui/material/styles';
import type { DetectedTarget } from '@agenshield/ipc';
import {
  SectionTitle,
  TargetCard,
  TargetIcon,
  TargetInfo,
  TargetName,
  TargetMeta,
  EmptyText,
  SecondaryButton,
} from '../SetupPanel.styles';

interface ScanResultsStepProps {
  targets: DetectedTarget[];
  isLoading: boolean;
  onSelectTarget: (targetId: string) => void;
  onRescan: () => void;
}

const presetIcons: Record<string, typeof Terminal> = {
  'claude-code': Terminal,
  'openclaw': Globe,
  'cursor': Monitor,
};

export function ScanResultsStep({
  targets,
  isLoading,
  onSelectTarget,
  onRescan,
}: ScanResultsStepProps) {
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';

  const unshieldedTargets = targets.filter((t) => !t.shielded);

  // Loading state
  if (isLoading) {
    return (
      <div style={{ textAlign: 'center', padding: '32px 0' }}>
        <Search
          size={28}
          style={{
            opacity: 0.5,
            display: 'block',
            margin: '0 auto 12px',
            animation: 'spin 1.5s linear infinite',
          }}
          color={isDark ? '#C0C0C0' : '#555'}
        />
        <div style={{
          fontSize: 14,
          fontWeight: 600,
          marginBottom: 4,
          color: theme.palette.text.primary,
        }}>
          Scanning for targets...
        </div>
        <div style={{
          fontSize: 11,
          color: theme.palette.text.secondary,
        }}>
          Looking for shieldable applications on this system
        </div>
      </div>
    );
  }

  // No targets found
  if (unshieldedTargets.length === 0) {
    return (
      <>
        <EmptyText>
          <Search size={24} style={{ opacity: 0.3, display: 'block', margin: '0 auto 8px' }} />
          No shieldable targets detected
          <br />
          <span style={{ fontSize: 10 }}>Try rescanning or add a target manually.</span>
        </EmptyText>
        <SecondaryButton onClick={onRescan} style={{ marginTop: 12 }}>
          <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
            <RefreshCw size={13} />
            Rescan
          </span>
        </SecondaryButton>
      </>
    );
  }

  // Show unshielded targets
  return (
    <>
      <SectionTitle style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <Search size={13} color={isDark ? '#999' : '#666'} />
        Detected Targets
      </SectionTitle>

      <div style={{
        fontSize: 11,
        color: theme.palette.text.secondary,
        marginBottom: 12,
      }}>
        {unshieldedTargets.length} target{unshieldedTargets.length !== 1 ? 's' : ''} found.
        Select one to shield.
      </div>

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
                {target.binaryPath ?? target.method}
              </TargetMeta>
            </TargetInfo>
            <span style={{
              display: 'flex',
              alignItems: 'center',
              gap: 3,
              fontSize: 10,
              fontWeight: 600,
              color: isDark ? '#EDEDED' : '#171717',
              letterSpacing: 0.3,
            }}>
              Shield
              <ArrowRight size={11} />
            </span>
          </TargetCard>
        );
      })}

      <SecondaryButton onClick={onRescan} style={{ marginTop: 12 }}>
        <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
          <RefreshCw size={13} />
          Rescan
        </span>
      </SecondaryButton>
    </>
  );
}
