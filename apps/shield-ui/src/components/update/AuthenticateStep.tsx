/**
 * Authenticate Step — passcode input for update authorization
 */

import { useState } from 'react';
import { Box, Typography, TextField, Button, Alert } from '@mui/material';
import { Lock, ArrowRight } from 'lucide-react';
import { useSnapshot } from 'valtio';
import { updateStore } from '../../state/update';
import { useAuthenticate } from '../../api/update';
import { slideIn } from '../../styles/animations';

interface AuthenticateStepProps {
  onNext: () => void;
}

export function AuthenticateStep({ onNext }: AuthenticateStepProps) {
  const [passcode, setPasscode] = useState('');
  const authenticate = useAuthenticate();
  const { authError } = useSnapshot(updateStore);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!passcode.trim()) return;

    updateStore.authError = null;
    authenticate.mutate(passcode, {
      onSuccess: (data) => {
        if (data.success) {
          onNext();
        } else {
          updateStore.authError = 'Authentication failed';
        }
      },
      onError: (err) => {
        updateStore.authError = (err as Error).message || 'Invalid passcode';
      },
    });
  };

  return (
    <Box sx={{ animation: `${slideIn} 0.3s ease-out` }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1 }}>
        <Lock size={22} />
        <Typography variant="h5" fontWeight={700}>
          Authentication Required
        </Typography>
      </Box>
      <Typography variant="body1" color="text.secondary" sx={{ mb: 3, lineHeight: 1.6 }}>
        Enter your AgenShield passcode to authorize the update.
      </Typography>

      <form onSubmit={handleSubmit}>
        {(authError || authenticate.isError) && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {authError || authenticate.error?.message || 'Invalid passcode'}
          </Alert>
        )}

        <TextField
          fullWidth
          type="password"
          label="Passcode"
          value={passcode}
          onChange={(e) => setPasscode(e.target.value)}
          autoFocus
          InputLabelProps={{ shrink: true }}
          sx={{ mb: 3 }}
        />

        <Button
          type="submit"
          variant="contained"
          size="large"
          disabled={!passcode.trim() || authenticate.isPending}
          endIcon={<ArrowRight size={18} />}
          sx={{ textTransform: 'none', fontWeight: 600 }}
        >
          {authenticate.isPending ? 'Verifying...' : 'Authenticate'}
        </Button>
      </form>
    </Box>
  );
}
