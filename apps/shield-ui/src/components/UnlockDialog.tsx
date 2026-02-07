/**
 * Unlock dialog for guarded actions.
 *
 * Variant of PasscodeDialog that shows a custom description and action label.
 * Used by UnlockContext to prompt for authentication before executing a protected action.
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

interface UnlockDialogProps {
  open: boolean;
  description: string;
  actionLabel: string;
  onSuccess: () => void;
  onClose: () => void;
}

export function UnlockDialog({ open, description, actionLabel, onSuccess, onClose }: UnlockDialogProps) {
  const { unlock, lockedOut, lockedUntil } = useAuth();

  const [passcode, setPasscode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [remainingAttempts, setRemainingAttempts] = useState<number | undefined>();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const result = await unlock(passcode);
      if (result.success) {
        setPasscode('');
        setError(null);
        setRemainingAttempts(undefined);
        onSuccess();
      } else {
        setError(result.error || 'Invalid passcode');
        setRemainingAttempts(result.remainingAttempts);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    setPasscode('');
    setError(null);
    setRemainingAttempts(undefined);
    onClose();
  };

  const isLocked = lockedOut;
  const lockoutTime = lockedUntil ? new Date(lockedUntil).toLocaleTimeString() : '';

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      maxWidth="xs"
      fullWidth
    >
      <DialogTitle>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <LockIcon size={20} />
          Unlock Required
        </Box>
      </DialogTitle>

      <form onSubmit={handleSubmit}>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {description}
          </Typography>

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
            inputRef={(input: HTMLInputElement | null) => { if (input) setTimeout(() => input.focus(), 50); }}
            disabled={isLocked || loading}
            inputProps={{ minLength: 4 }}
          />
        </DialogContent>

        <DialogActions>
          <Button onClick={handleClose} disabled={loading}>
            Cancel
          </Button>
          <Button
            type="submit"
            variant="contained"
            disabled={isLocked || loading || !passcode}
          >
            {loading ? 'Verifying...' : actionLabel}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
