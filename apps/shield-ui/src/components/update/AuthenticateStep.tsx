/**
 * Authenticate Step — sudo login for update authorization
 */

import { useState } from 'react';
import { Box, Typography, TextField, Button, Alert } from '@mui/material';
import { Lock, ArrowRight } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { slideIn } from '../../styles/animations';

interface AuthenticateStepProps {
  onNext: () => void;
}

export function AuthenticateStep({ onNext }: AuthenticateStepProps) {
  const { loginWithSudo, authenticated } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // If already authenticated via JWT, skip to next step
  if (authenticated) {
    onNext();
    return null;
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password) return;
    setError(null);
    setLoading(true);
    try {
      const result = await loginWithSudo(username, password);
      if (result.success) {
        onNext();
      } else {
        setError(result.error || 'Authentication failed');
      }
    } finally {
      setLoading(false);
    }
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
        Enter your macOS credentials to authorize the update.
      </Typography>

      <form onSubmit={handleSubmit} autoComplete="off">
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}

        <TextField
          fullWidth
          label="Username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoFocus
          InputLabelProps={{ shrink: true }}
          sx={{ mb: 2 }}
          inputProps={{ autoComplete: 'off' }}
        />

        <TextField
          fullWidth
          type="password"
          label="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          InputLabelProps={{ shrink: true }}
          sx={{ mb: 3 }}
          inputProps={{ autoComplete: 'off' }}
        />

        <Button
          type="submit"
          variant="contained"
          size="large"
          disabled={!username.trim() || !password || loading}
          endIcon={<ArrowRight size={18} />}
          sx={{ textTransform: 'none', fontWeight: 600 }}
        >
          {loading ? 'Verifying...' : 'Authenticate'}
        </Button>
      </form>
    </Box>
  );
}
