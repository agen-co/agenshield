/**
 * Detection step — shows detected targets, old installations, and manual add buttons
 */

import { useCallback } from 'react';
import { Search, Shield, AlertTriangle, RefreshCw, Terminal, Globe, Monitor, Plus } from 'lucide-react';
import { useTheme } from '@mui/material/styles';
import type { DetectionStepProps } from '../SetupPanel.types';
import {
  SectionTitle,
  TargetCard,
  TargetIcon,
  TargetInfo,
  TargetName,
  TargetMeta,
  EmptyText,
  ActionButton,
  ShieldedBadge,
} from '../SetupPanel.styles';
import { KNOWN_PRESETS, addManualTarget } from '../../../../../state/setup-panel';

const presetIcons: Record<string, typeof Terminal> = {
  'claude-code': Terminal,
  'openclaw': Globe,
  'cursor': Monitor,
};

export function DetectionStep({
  targets,
  oldInstallations,
  isLoading,
  onRefresh,
  onSelectTarget,
  selectedTargetId,
}: DetectionStepProps) {
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';

  const handleManualAdd = useCallback((presetId: string) => {
    addManualTarget(presetId);
  }, []);

  // IDs already in the list (detected or manually added)
  const existingIds = new Set(targets.map((t) => t.id));

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <SectionTitle style={{ margin: 0 }}>Detected Targets</SectionTitle>
        <button
          onClick={onRefresh}
          disabled={isLoading}
          style={{
            background: 'none',
            border: 'none',
            cursor: isLoading ? 'default' : 'pointer',
            color: theme.palette.text.secondary,
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            fontSize: 10,
            fontFamily: "'Manrope', sans-serif",
            padding: '2px 6px',
            borderRadius: 4,
            opacity: isLoading ? 0.5 : 1,
          }}
        >
          <RefreshCw size={12} style={{ animation: isLoading ? 'spin 1s linear infinite' : 'none' }} />
          {isLoading ? 'Scanning...' : 'Rescan'}
        </button>
      </div>

      {targets.length === 0 && !isLoading && (
        <EmptyText>
          <Search size={24} style={{ opacity: 0.3, marginBottom: 8, display: 'block', margin: '0 auto 8px' }} />
          No targets detected on this system.
          <br />
          <span style={{ fontSize: 10 }}>Try rescanning or add a target manually below.</span>
        </EmptyText>
      )}

      {targets.map((target) => (
        <TargetCard
          key={target.id}
          $selected={selectedTargetId === target.id}
          onClick={() => !target.shielded && onSelectTarget(target.id)}
          style={{ cursor: target.shielded ? 'default' : 'pointer' }}
        >
          <TargetIcon>
            <Shield size={18} color={target.shielded ? '#6CB685' : (isDark ? '#999' : '#666')} />
          </TargetIcon>
          <TargetInfo>
            <TargetName>{target.name}</TargetName>
            <TargetMeta>
              {target.version && `v${target.version} · `}
              {target.method}
              {target.binaryPath && ` · ${target.binaryPath}`}
            </TargetMeta>
          </TargetInfo>
          {target.shielded && <ShieldedBadge>Shielded</ShieldedBadge>}
        </TargetCard>
      ))}

      {oldInstallations.length > 0 && (
        <>
          <SectionTitle style={{ marginTop: 16 }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <AlertTriangle size={12} color="#EEA45F" />
              Old Installation Detected
            </span>
          </SectionTitle>
          {oldInstallations.map((inst, i) => (
            <TargetCard key={i} $selected={false} style={{ cursor: 'default', borderColor: 'rgba(238,164,95,0.3)' }}>
              <TargetIcon style={{ backgroundColor: 'rgba(238,164,95,0.1)' }}>
                <AlertTriangle size={18} color="#EEA45F" />
              </TargetIcon>
              <TargetInfo>
                <TargetName>AgenShield {inst.version}</TargetName>
                <TargetMeta>
                  {inst.components.users.length} users · {inst.components.directories.length} dirs
                  {inst.components.launchDaemons.length > 0 && ` · ${inst.components.launchDaemons.length} daemons`}
                </TargetMeta>
              </TargetInfo>
            </TargetCard>
          ))}
          <ActionButton style={{ marginTop: 8, backgroundColor: '#EEA45F', color: '#171717' }}>
            Replace Old Installation
          </ActionButton>
        </>
      )}

      {/* Manual add section */}
      <SectionTitle style={{ marginTop: 16, display: 'flex', alignItems: 'center', gap: 4 }}>
        <Plus size={12} />
        Or add manually
      </SectionTitle>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {KNOWN_PRESETS.map((preset) => {
          const Icon = presetIcons[preset.id] ?? Terminal;
          const instanceCount = targets.filter((t) => t.type === preset.id).length;
          return (
            <button
              key={preset.id}
              onClick={() => handleManualAdd(preset.id)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 5,
                padding: '5px 10px',
                borderRadius: 6,
                border: `1px solid ${isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.12)'}`,
                backgroundColor: 'transparent',
                color: theme.palette.text.primary,
                fontSize: 11,
                fontWeight: 500,
                fontFamily: "'Manrope', sans-serif",
                cursor: 'pointer',
                transition: 'background-color 0.2s',
              }}
            >
              <Icon size={12} />
              {preset.name}{instanceCount > 0 ? ` (${instanceCount})` : ''}
            </button>
          );
        })}
      </div>

      {selectedTargetId && (
        <div style={{ marginTop: 16 }}>
          <ActionButton onClick={() => onSelectTarget(selectedTargetId)}>
            Continue with {targets.find((t) => t.id === selectedTargetId)?.name}
          </ActionButton>
        </div>
      )}
    </>
  );
}
