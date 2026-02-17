/**
 * Configure step — pre-shield configuration for a target
 */

import { ArrowLeft, Settings, Shield } from 'lucide-react';
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

export function ConfigureStep({ target, onBack, onShield }: ConfigureStepProps) {
  if (!target) return null;

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

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <ActionButton onClick={onShield}>
          Shield {target.name}
        </ActionButton>
        <SecondaryButton onClick={onBack}>
          Cancel
        </SecondaryButton>
      </div>
    </>
  );
}
