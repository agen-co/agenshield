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

interface ConfigCategoryOption {
  id: string;
  label: string;
  description: string;
  defaultOn: boolean;
  forced: boolean;
}

const CLAUDE_CONFIG_CATEGORIES: ConfigCategoryOption[] = [
  { id: 'settings', label: 'Settings', description: 'settings.json (MCP servers, preferences)', defaultOn: true, forced: true },
  { id: 'plugins', label: 'Plugins', description: 'Installed plugins and marketplace config', defaultOn: true, forced: false },
  { id: 'memory', label: 'Memory', description: 'Project memory files (MEMORY.md)', defaultOn: true, forced: false },
  { id: 'statsig', label: 'Feature flags', description: 'Statsig feature flag cache', defaultOn: true, forced: false },
  { id: 'plans', label: 'Plans', description: 'Plan mode files', defaultOn: false, forced: false },
];

const OPENCLAW_CONFIG_CATEGORIES: ConfigCategoryOption[] = [
  { id: 'config', label: 'Config', description: 'openclaw.json (settings, preferences)', defaultOn: true, forced: false },
  { id: 'skills', label: 'Skills', description: 'Installed skills directory', defaultOn: true, forced: false },
  { id: 'plugins', label: 'Plugins', description: 'Installed plugins directory', defaultOn: true, forced: false },
  { id: 'workspace', label: 'Workspace', description: 'Workspace directory (may be large)', defaultOn: false, forced: false },
  { id: 'cache', label: 'Cache', description: 'Cache directory', defaultOn: false, forced: false },
];

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

  // Config copy categories (claude-code and openclaw targets)
  const isClaudeCode = target?.type === 'claude-code';
  const isOpenClaw = target?.type === 'openclaw';
  const configCategories = isOpenClaw ? OPENCLAW_CONFIG_CATEGORIES : CLAUDE_CONFIG_CATEGORIES;
  const hasConfigCategories = isClaudeCode || isOpenClaw;
  const [selectedCategories, setSelectedCategories] = useState<Set<string>>(
    () => new Set(configCategories.filter(c => c.defaultOn).map(c => c.id)),
  );

  // Enforcement mode (claude-code only)
  const [enforcementMode, setEnforcementMode] = useState<'proxy' | 'interceptor' | 'both'>('both');

  useEffect(() => {
    setBaseName(defaultBaseName);
    setTouched(false);
    setVersionChoice(detectedVersion ? 'detected' : 'latest');
    setCustomVersion('');
    const cats = target?.type === 'openclaw' ? OPENCLAW_CONFIG_CATEGORIES : CLAUDE_CONFIG_CATEGORIES;
    setSelectedCategories(new Set(cats.filter(c => c.defaultOn).map(c => c.id)));
    setEnforcementMode('both');
  }, [defaultBaseName, detectedVersion, target?.type]);

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

      {/* Config copy categories (claude-code and openclaw) */}
      {hasConfigCategories && (
        <div style={{ marginBottom: 16 }}>
          <label style={{
            display: 'block',
            fontSize: 12,
            fontWeight: 600,
            marginBottom: 6,
            color: theme.palette.text.primary,
          }}>
            Host config to copy
          </label>
          <div style={{
            fontSize: 10,
            marginBottom: 6,
            color: theme.palette.text.secondary,
          }}>
            Select which parts of {isOpenClaw ? '~/.openclaw' : '~/.claude'} to copy into the sandbox
          </div>
          {configCategories.map((cat) => (
            <label key={cat.id} style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 6,
              padding: '3px 0',
              fontSize: 12,
              cursor: cat.forced ? 'default' : 'pointer',
              opacity: cat.forced ? 0.7 : 1,
            }}>
              <input
                type="checkbox"
                checked={selectedCategories.has(cat.id)}
                disabled={cat.forced}
                onChange={() => {
                  setSelectedCategories(prev => {
                    const next = new Set(prev);
                    if (next.has(cat.id)) next.delete(cat.id);
                    else next.add(cat.id);
                    return next;
                  });
                }}
                style={{ accentColor: isDark ? '#C0C0C0' : '#333', marginTop: 2 }}
              />
              <span>
                <span style={{ fontWeight: 500 }}>{cat.label}</span>
                <span style={{
                  display: 'block',
                  fontSize: 10,
                  color: theme.palette.text.secondary,
                  marginTop: 1,
                }}>
                  {cat.description}
                </span>
              </span>
            </label>
          ))}
        </div>
      )}

      {/* Enforcement mode (claude-code only) */}
      {isClaudeCode && (
        <div style={{ marginBottom: 16 }}>
          <label style={{
            display: 'block',
            fontSize: 12,
            fontWeight: 600,
            marginBottom: 2,
            color: theme.palette.text.primary,
          }}>
            Enforcement mode
          </label>
          <div style={{
            fontSize: 10,
            marginBottom: 6,
            color: theme.palette.text.secondary,
          }}>
            How network requests are intercepted and controlled
          </div>

          <label style={{ ...radioStyle, alignItems: 'flex-start' }}>
            <input
              type="radio"
              name="enforcementMode"
              checked={enforcementMode === 'both'}
              onChange={() => setEnforcementMode('both')}
              style={{ accentColor: isDark ? '#C0C0C0' : '#333', marginTop: 2 }}
            />
            <span>
              <span style={{ fontWeight: 500 }}>Both (defense-in-depth)</span>
              <span style={{
                display: 'block',
                fontSize: 10,
                color: theme.palette.text.secondary,
                marginTop: 1,
              }}>
                Proxy + interceptor. Strongest protection.
              </span>
            </span>
          </label>

          <label style={{ ...radioStyle, alignItems: 'flex-start' }}>
            <input
              type="radio"
              name="enforcementMode"
              checked={enforcementMode === 'proxy'}
              onChange={() => setEnforcementMode('proxy')}
              style={{ accentColor: isDark ? '#C0C0C0' : '#333', marginTop: 2 }}
            />
            <span>
              <span style={{ fontWeight: 500 }}>Proxy only</span>
              <span style={{
                display: 'block',
                fontSize: 10,
                color: theme.palette.text.secondary,
                marginTop: 1,
              }}>
                Network-level via HTTPS_PROXY + kernel sandbox.
              </span>
            </span>
          </label>

          <label style={{ ...radioStyle, alignItems: 'flex-start' }}>
            <input
              type="radio"
              name="enforcementMode"
              checked={enforcementMode === 'interceptor'}
              onChange={() => setEnforcementMode('interceptor')}
              style={{ accentColor: isDark ? '#C0C0C0' : '#333', marginTop: 2 }}
            />
            <span>
              <span style={{ fontWeight: 500 }}>Interceptor only</span>
              <span style={{
                display: 'block',
                fontSize: 10,
                color: theme.palette.text.secondary,
                marginTop: 1,
              }}>
                Application-level hooks. More compatible.
              </span>
            </span>
          </label>
        </div>
      )}

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
        <ActionButton onClick={() => onShield(baseName, resolvedVersion, hasConfigCategories ? Array.from(selectedCategories) : undefined, isClaudeCode ? enforcementMode : undefined)} disabled={!isValid || !isCustomVersionValid}>
          Shield {target.name}
        </ActionButton>
        <SecondaryButton onClick={onBack}>
          Cancel
        </SecondaryButton>
      </div>
    </>
  );
}
