/**
 * PasscodeStep — set up initial passcode during first-run setup.
 *
 * Two inputs (passcode + confirm), min 4 chars. Passcode is mandatory —
 * it encrypts secrets and protects the dashboard.
 */

import { useState, useRef } from 'react';
import { Lock } from 'lucide-react';
import { useTheme } from '@mui/material/styles';
import { useAuth } from '../../../../../context/AuthContext';
import {
  SectionTitle,
  ActionButton,
} from '../SetupPanel.styles';

interface PasscodeStepProps {
  onComplete: () => void;
  onTyping: () => void;
}

const MIN_LENGTH = 4;

export function PasscodeStep({ onComplete, onTyping }: PasscodeStepProps) {
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';
  const { setup } = useAuth();

  const [passcode, setPasscode] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const typingFired = useRef(false);

  const isValid = passcode.length >= MIN_LENGTH && passcode === confirm;
  const showMismatch = confirm.length > 0 && passcode !== confirm;

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '8px 10px',
    fontSize: 13,
    fontFamily: "'IBM Plex Mono', monospace",
    background: isDark ? '#1C1C20' : '#F5F5F5',
    border: `1px solid ${isDark ? '#333' : '#CCC'}`,
    borderRadius: 4,
    color: theme.palette.text.primary,
    outline: 'none',
    boxSizing: 'border-box' as const,
  };

  const handleSubmit = async () => {
    if (!isValid || loading) return;
    setError(null);
    setLoading(true);
    try {
      const result = await setup(passcode);
      if (result.success) {
        onComplete();
      } else {
        setError(result.error ?? 'Failed to set passcode');
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        marginBottom: 16,
      }}>
        <Lock size={16} color={isDark ? '#C0C0C0' : '#333'} />
        <SectionTitle style={{ marginBottom: 0, marginTop: 0 }}>
          Set Passcode
        </SectionTitle>
      </div>

      <div style={{ fontSize: 12, lineHeight: 1.6, marginBottom: 16, opacity: 0.8 }}>
        Protect your AgenShield dashboard with a passcode.
        This encrypts secrets and prevents unauthorized access.
      </div>

      {/* Passcode input */}
      <div style={{ marginBottom: 12 }}>
        <label style={{
          display: 'block',
          fontSize: 12,
          fontWeight: 600,
          marginBottom: 4,
          color: theme.palette.text.primary,
        }}>
          Passcode
        </label>
        <input
          type="password"
          value={passcode}
          onChange={(e) => {
            const val = e.target.value;
            setPasscode(val);
            if (!typingFired.current && val.length > 0) {
              typingFired.current = true;
              onTyping();
            }
          }}
          placeholder="Min. 4 characters"
          style={inputStyle}
          autoFocus
        />
      </div>

      {/* Confirm input */}
      <div style={{ marginBottom: 16 }}>
        <label style={{
          display: 'block',
          fontSize: 12,
          fontWeight: 600,
          marginBottom: 4,
          color: theme.palette.text.primary,
        }}>
          Confirm passcode
        </label>
        <input
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          placeholder="Re-enter passcode"
          style={{
            ...inputStyle,
            borderColor: showMismatch ? '#E1583E' : inputStyle.borderColor,
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && isValid) handleSubmit();
          }}
        />
        {showMismatch && (
          <div style={{ fontSize: 10, marginTop: 3, color: '#E1583E' }}>
            Passcodes do not match
          </div>
        )}
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

      <ActionButton onClick={handleSubmit} disabled={!isValid || loading}>
        {loading ? 'Setting up...' : 'Set Passcode'}
      </ActionButton>
    </>
  );
}
