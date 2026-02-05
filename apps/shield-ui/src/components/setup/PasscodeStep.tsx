/**
 * Step 5: Passcode — set a passcode to protect the daemon or skip
 */

import { useState, useCallback } from 'react';
import { Box, Typography, Button, TextField, Alert } from '@mui/material';
import { Lock, SkipForward } from 'lucide-react';
import { slideIn } from '../../styles/animations';

interface PasscodeStepProps {
  onSet: (passcode: string) => void;
  onSkip: () => void;
}

export function PasscodeStep({ onSet, onSkip }: PasscodeStepProps) {
  const [passcode, setPasscode] = useState('');
  const [confirm, setConfirm] = useState('');

  const isMatch = passcode.length > 0 && passcode === confirm;
  const showMismatch = confirm.length > 0 && passcode !== confirm;

  const handleSubmit = useCallback(() => {
    if (isMatch) onSet(passcode);
  }, [isMatch, passcode, onSet]);

  return (
    <Box sx={{ animation: `${slideIn} 0.3s ease-out` }}>
      <Typography variant="h5" fontWeight={700} gutterBottom>
        Set Passcode
      </Typography>
      <Typography variant="body1" color="text.secondary" sx={{ mb: 3, lineHeight: 1.6 }}>
        Protect the AgenShield daemon with a passcode. This prevents unauthorized changes to security policies.
      </Typography>

      <Alert severity="info" icon={<Lock size={18} />} sx={{ mb: 3 }}>
        The passcode protects write access to settings and policies. You can always change or remove it later.
      </Alert>

      <TextField
        fullWidth
        type="password"
        label="Passcode"
        placeholder="Enter a passcode"
        value={passcode}
        onChange={e => setPasscode(e.target.value)}
        autoFocus
        sx={{ mb: 2 }}
      />

      <TextField
        fullWidth
        type="password"
        label="Confirm Passcode"
        placeholder="Confirm your passcode"
        value={confirm}
        onChange={e => setConfirm(e.target.value)}
        onKeyDown={e => e.key === 'Enter' && isMatch && handleSubmit()}
        error={showMismatch}
        helperText={showMismatch ? 'Passcodes do not match' : undefined}
        sx={{ mb: 3 }}
      />

      <Box sx={{ display: 'flex', gap: 1.5 }}>
        <Button
          variant="outlined"
          onClick={onSkip}
          startIcon={<SkipForward size={16} />}
          sx={{ textTransform: 'none' }}
        >
          Skip for now
        </Button>
        <Button
          variant="contained"
          disabled={!isMatch}
          onClick={handleSubmit}
          startIcon={<Lock size={16} />}
          sx={{ textTransform: 'none', fontWeight: 600 }}
        >
          Set Passcode
        </Button>
      </Box>
    </Box>
  );
}
