/**
 * Complete step — setup finished, transition to daemon mode
 */

import { CheckCircle, Plus } from 'lucide-react';
import type { CompleteStepProps } from '../SetupPanel.types';
import {
  SectionTitle,
  ActionButton,
  SecondaryButton,
} from '../SetupPanel.styles';

export function CompleteStep({ mode, onComplete, onAddAnother }: CompleteStepProps) {
  const isInitialSetup = mode === 'initial-setup';

  return (
    <>
      <div style={{ textAlign: 'center', padding: '32px 0 24px' }}>
        <CheckCircle size={40} color="#6CB685" style={{ marginBottom: 12 }} />
        <SectionTitle style={{ fontSize: 16, marginBottom: 8 }}>
          {isInitialSetup ? 'Setup Complete' : 'Profile Added'}
        </SectionTitle>
        <div style={{ fontSize: 12, opacity: 0.7, lineHeight: 1.5 }}>
          {isInitialSetup
            ? 'AgenShield is now protecting your targets. The dashboard is fully accessible.'
            : 'The new target has been shielded and is now being monitored.'
          }
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <ActionButton onClick={onComplete}>
          {isInitialSetup ? 'Open Dashboard' : 'Done'}
        </ActionButton>
        <SecondaryButton onClick={onAddAnother}>
          <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
            <Plus size={12} />
            Shield Another Target
          </span>
        </SecondaryButton>
      </div>
    </>
  );
}
