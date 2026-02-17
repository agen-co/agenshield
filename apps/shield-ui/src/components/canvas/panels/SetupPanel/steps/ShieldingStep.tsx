/**
 * Shielding step — shows progress while a target is being shielded
 */

import { Shield, Loader } from 'lucide-react';
import type { ShieldingStepProps } from '../SetupPanel.types';
import {
  SectionTitle,
  ProgressBar,
  ProgressFill,
  ProgressLabel,
} from '../SetupPanel.styles';

export function ShieldingStep({ targetId, progress }: ShieldingStepProps) {
  const pct = progress?.progress ?? 0;
  const step = progress?.currentStep ?? 'initializing';
  const message = progress?.message ?? 'Preparing...';
  const isComplete = progress?.status === 'completed';
  const isError = progress?.status === 'error';

  return (
    <>
      <div style={{ textAlign: 'center', padding: '24px 0 16px' }}>
        <div style={{ marginBottom: 12 }}>
          {isComplete ? (
            <Shield size={32} color="#6CB685" />
          ) : isError ? (
            <Shield size={32} color="#E1583E" />
          ) : (
            <Loader size={32} style={{ animation: 'spin 2s linear infinite', opacity: 0.6 }} />
          )}
        </div>
        <SectionTitle style={{ fontSize: 14, marginBottom: 4 }}>
          {isComplete ? 'Shielding Complete' : isError ? 'Shielding Failed' : 'Shielding Target'}
        </SectionTitle>
        <div style={{ fontSize: 11, opacity: 0.6 }}>
          {targetId}
        </div>
      </div>

      <ProgressBar>
        <ProgressFill $progress={pct} style={isError ? { backgroundColor: '#E1583E' } : undefined} />
      </ProgressBar>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <ProgressLabel>{message}</ProgressLabel>
        <ProgressLabel style={{ fontWeight: 600 }}>{pct}%</ProgressLabel>
      </div>

      <div style={{ marginTop: 16, fontSize: 11, opacity: 0.5 }}>
        Step: {step}
      </div>
    </>
  );
}
