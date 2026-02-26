/**
 * Configure step — pre-shield configuration for a target
 */

import { useState, useMemo, useEffect } from 'react';
import { ArrowLeft, Settings, Shield } from 'lucide-react';
import { useTheme } from '@mui/material/styles';
import type { ConfigureStepProps } from '../SetupPanel.types';
import {
  SectionTitle,
  ActionButton,
  SecondaryButton,
  TargetCard,
  TargetIcon,
  TargetInfo,
  TargetName,
  TargetMeta,
} from '../SetupPanel.styles';

const BASE_NAME_REGEX = /^[a-z0-9-]*$/;
const MAX_BASE_NAME = 16;

type VersionChoice = 'detected' | 'latest' | 'custom';

function deriveDefaultBaseName(targetType: string, targetId: string): string {
  const map: Record<string, string> = {
    'claude-code': 'claude',
    'openclaw': 'openclaw',
    'dev-harness': 'devharness',
    'cursor': 'cursor',
  };
  const base = map[targetType] ?? targetType.replace(/-/g, '').slice(0, MAX_BASE_NAME);
  // Auto-suffix for numbered instances (e.g. 'claude-code-1' → 'claude2')
  const instanceMatch = targetId.match(/-(\d+)$/);
  if (instanceMatch) {
    return `${base}${parseInt(instanceMatch[1]) + 1}`;
  }
  return base;
}

export function ConfigureStep({ target, onBack, onShield, error }: ConfigureStepProps) {
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';

  const defaultBaseName = useMemo(
    () => (target ? deriveDefaultBaseName(target.type, target.id) : 'default'),
    [target],
  );
  const [baseName, setBaseName] = useState(defaultBaseName);
  const [touched, setTouched] = useState(false);

  // Version picker state
  const detectedVersion = target?.version;
  const [versionChoice, setVersionChoice] = useState<VersionChoice>(detectedVersion ? 'detected' : 'latest');
  const [customVersion, setCustomVersion] = useState('');

  useEffect(() => {
    setBaseName(defaultBaseName);
    setTouched(false);
    setVersionChoice(detectedVersion ? 'detected' : 'latest');
    setCustomVersion('');
  }, [defaultBaseName, detectedVersion]);

  if (!target) return null;

  const isValid = BASE_NAME_REGEX.test(baseName) && baseName.length > 0 && baseName.length <= MAX_BASE_NAME;
  const showError = touched && !isValid;

  const isCustomVersionValid = versionChoice !== 'custom' || /^[\w.-]+$/.test(customVersion);

  const resolvedVersion = versionChoice === 'detected' && detectedVersion
    ? detectedVersion
    : versionChoice === 'custom'
      ? customVersion
      : undefined; // 'latest' → undefined (server default)

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '6px 8px',
    fontSize: 12,
    fontFamily: "'IBM Plex Mono', monospace",
    background: isDark ? '#1C1C20' : '#F5F5F5',
    border: `1px solid ${showError ? '#E1583E' : isDark ? '#333' : '#CCC'}`,
    borderRadius: 4,
    color: theme.palette.text.primary,
    outline: 'none',
    boxSizing: 'border-box',
  };

  const radioStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '4px 0',
    fontSize: 12,
    cursor: 'pointer',
  };

  return (
    <>
      <button
        onClick={onBack}
        style={{
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          fontSize: 11,
          fontFamily: "'Manrope', sans-serif",
          padding: '2px 0',
          marginBottom: 12,
          color: 'inherit',
          opacity: 0.7,
        }}
      >
        <ArrowLeft size={12} />
        Back to detection
      </button>

      <SectionTitle>Target Configuration</SectionTitle>

      <TargetCard $selected={false} style={{ cursor: 'default', marginBottom: 16 }}>
        <TargetIcon>
          <Settings size={18} />
        </TargetIcon>
        <TargetInfo>
          <TargetName>{target.name}</TargetName>
          <TargetMeta>
            {target.version && `v${target.version} · `}
            {target.type} · {target.method}
          </TargetMeta>
        </TargetInfo>
      </TargetCard>

      {/* Base name input */}
      <div style={{ marginBottom: 16 }}>
        <label style={{
          display: 'block',
          fontSize: 12,
          fontWeight: 600,
          marginBottom: 4,
          color: theme.palette.text.primary,
        }}>
          Sandbox username prefix
        </label>
        <input
          type="text"
          value={baseName}
          onChange={(e) => {
            setBaseName(e.target.value);
            setTouched(true);
          }}
          onBlur={() => setTouched(true)}
          placeholder="e.g. claude"
          maxLength={MAX_BASE_NAME}
          style={inputStyle}
        />
        <div style={{
          fontSize: 10,
          marginTop: 3,
          color: showError ? '#E1583E' : theme.palette.text.secondary,
        }}>
          {showError
            ? 'Lowercase alphanumeric and hyphens only, max 16 chars'
            : `Creates ash_${baseName}_agent and ash_${baseName}_broker`
          }
        </div>
      </div>

      {/* Version picker */}
      <div style={{ marginBottom: 16 }}>
        <label style={{
          display: 'block',
          fontSize: 12,
          fontWeight: 600,
          marginBottom: 6,
          color: theme.palette.text.primary,
        }}>
          Install version
        </label>

        {detectedVersion && (
          <label style={radioStyle}>
            <input
              type="radio"
              name="version"
              checked={versionChoice === 'detected'}
              onChange={() => setVersionChoice('detected')}
              style={{ accentColor: isDark ? '#C0C0C0' : '#333' }}
            />
            <span>Detected: <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontWeight: 600 }}>{detectedVersion}</span></span>
          </label>
        )}

        <label style={radioStyle}>
          <input
            type="radio"
            name="version"
            checked={versionChoice === 'latest'}
            onChange={() => setVersionChoice('latest')}
            style={{ accentColor: isDark ? '#C0C0C0' : '#333' }}
          />
          <span>Latest</span>
        </label>

        <label style={radioStyle}>
          <input
            type="radio"
            name="version"
            checked={versionChoice === 'custom'}
            onChange={() => setVersionChoice('custom')}
            style={{ accentColor: isDark ? '#C0C0C0' : '#333' }}
          />
          <span>Custom version</span>
        </label>

        {versionChoice === 'custom' && (
          <input
            type="text"
            value={customVersion}
            onChange={(e) => setCustomVersion(e.target.value)}
            placeholder="e.g. 2026.2.6"
            style={{
              ...inputStyle,
              marginTop: 4,
              border: `1px solid ${!isCustomVersionValid ? '#E1583E' : isDark ? '#333' : '#CCC'}`,
            }}
          />
        )}
      </div>

      <div style={{ fontSize: 12, lineHeight: 1.6, marginBottom: 16, opacity: 0.8 }}>
        Shielding will:
      </div>

      <div style={{ fontSize: 11, lineHeight: 1.8, marginBottom: 24, paddingLeft: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Shield size={11} color="#6CB685" /> Create a sandboxed profile
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Shield size={11} color="#6CB685" /> Install command wrappers
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Shield size={11} color="#6CB685" /> Apply default security policies
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Shield size={11} color="#6CB685" /> Enable real-time monitoring
        </div>
      </div>

      {error && (
        <div style={{
          padding: '8px 10px',
          marginBottom: 12,
          fontSize: 11,
          lineHeight: 1.5,
          fontFamily: "'IBM Plex Mono', monospace",
          color: '#E1583E',
          background: isDark ? 'rgba(225, 88, 62, 0.08)' : 'rgba(225, 88, 62, 0.06)',
          border: '1px solid rgba(225, 88, 62, 0.3)',
          borderRadius: 4,
        }}>
          {error}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <ActionButton onClick={() => onShield(baseName, resolvedVersion)} disabled={!isValid || !isCustomVersionValid}>
          Shield {target.name}
        </ActionButton>
        <SecondaryButton onClick={onBack}>
          Cancel
        </SecondaryButton>
      </div>
    </>
  );
}
