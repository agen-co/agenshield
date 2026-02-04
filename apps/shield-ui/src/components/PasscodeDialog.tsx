/**
 * Passcode dialog component
 *
 * Modal dialog for entering passcode to unlock the UI,
 * or setting up an initial passcode.
 */

import React, { useState } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Button,
  Alert,
  Typography,
  Box,
} from '@mui/material';
import { Lock as LockIcon } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

interface PasscodeDialogProps {
  open: boolean;
  onClose?: () => void;
  mode?: 'unlock' | 'setup';
}

export function PasscodeDialog({ open, onClose, mode: initialMode }: PasscodeDialogProps) {
  const { passcodeSet, unlock, setup, lockedOut, lockedUntil } = useAuth();
  const mode = initialMode || (passcodeSet ? 'unlock' : 'setup');

  const [passcode, setPasscode] = useState('');
  const [confirmPasscode, setConfirmPasscode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [remainingAttempts, setRemainingAttempts] = useState<number | undefined>();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      if (mode === 'setup') {
        if (passcode.length < 4) {
          setError('Passcode must be at least 4 characters');
          return;
        }
        if (passcode !== confirmPasscode) {
          setError('Passcodes do not match');
          return;
        }
        const result = await setup(passcode);
        if (result.success) {
          setPasscode('');
          setConfirmPasscode('');
          onClose?.();
        } else {
          setError(result.error || 'Setup failed');
        }
      } else {
        const result = await unlock(passcode);
        if (result.success) {
          setPasscode('');
          onClose?.();
        } else {
          setError(result.error || 'Invalid passcode');
          setRemainingAttempts(result.remainingAttempts);
        }
      }
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    if (onClose) {
      setPasscode('');
      setConfirmPasscode('');
      setError(null);
      onClose();
    }
  };

  const isLocked = lockedOut;
  const lockoutTime = lockedUntil ? new Date(lockedUntil).toLocaleTimeString() : '';

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      maxWidth="xs"
      fullWidth
      disableEscapeKeyDown={!onClose}
    >
      <DialogTitle>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <LockIcon size={20} />
          {mode === 'setup' ? 'Set Up Passcode' : 'Unlock AgenShield'}
        </Box>
      </DialogTitle>

      <form onSubmit={handleSubmit}>
        <DialogContent>
          {mode === 'setup' ? (
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Set a passcode to protect sensitive configuration. You will need this passcode to
              make changes to skills, policies, and secrets.
            </Typography>
          ) : (
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Enter your passcode to access protected settings.
            </Typography>
          )}

          {isLocked && (
            <Alert severity="error" sx={{ mb: 2 }}>
              Account locked due to too many failed attempts. Try again after {lockoutTime}.
            </Alert>
          )}

          {error && !isLocked && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {error}
              {remainingAttempts !== undefined && remainingAttempts > 0 && (
                <> ({remainingAttempts} attempts remaining)</>
              )}
            </Alert>
          )}

          <TextField
            label="Passcode"
            type="password"
            value={passcode}
            onChange={(e) => setPasscode(e.target.value)}
            fullWidth
            autoFocus
            disabled={isLocked || loading}
            sx={{ mb: mode === 'setup' ? 2 : 0 }}
            inputProps={{ minLength: 4 }}
          />

          {mode === 'setup' && (
            <TextField
              label="Confirm Passcode"
              type="password"
              value={confirmPasscode}
              onChange={(e) => setConfirmPasscode(e.target.value)}
              fullWidth
              disabled={loading}
              inputProps={{ minLength: 4 }}
            />
          )}
        </DialogContent>

        <DialogActions>
          {onClose && (
            <Button onClick={handleClose} disabled={loading}>
              Cancel
            </Button>
          )}
          <Button
            type="submit"
            variant="contained"
            disabled={isLocked || loading || !passcode}
          >
            {loading ? 'Verifying...' : mode === 'setup' ? 'Set Passcode' : 'Unlock'}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
