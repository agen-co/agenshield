/**
 * Full-screen login gate shown when the user is not authenticated.
 *
 * Provides a sudo password form that authenticates against the daemon
 * and stores the resulting JWT in AuthContext + sessionStorage.
 */

import { useState, type FormEvent } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import TextField from '@mui/material/TextField';
import Alert from '@mui/material/Alert';
import { Shield } from 'lucide-react';
import { PrimaryButton } from '../../elements';
import { authApi } from '../../api/auth';
import { useAuth } from '../../context/AuthContext';

export function LoginGate() {
  const { login } = useAuth();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!password.trim()) return;

    setError(null);
    setLoading(true);

    try {
      const result = await authApi.sudoLogin(password);
      if (result.success && result.token && result.expiresAt) {
        login(result.token, result.expiresAt);
      } else {
        setError(result.error || 'Authentication failed');
      }
    } catch (err) {
      const apiError = err as Error & { status?: number; data?: { error?: string } };
      if (apiError.status === 429) {
        setError('Too many attempts. Please wait before trying again.');
      } else {
        setError(apiError.data?.error || apiError.message || 'Authentication failed');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        bgcolor: 'background.default',
      }}
    >
      <Box
        component="form"
        onSubmit={handleSubmit}
        sx={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 3,
          width: '100%',
          maxWidth: 380,
          px: 3,
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1 }}>
          <Shield size={28} />
          <Typography variant="h5" fontWeight={700}>
            AgenShield
          </Typography>
        </Box>

        <Typography variant="body2" color="text.secondary" textAlign="center">
          Authentication required. Enter your system password to unlock.
        </Typography>

        {error && (
          <Alert severity="error" sx={{ width: '100%' }}>
            {error}
          </Alert>
        )}

        <TextField
          fullWidth
          type="password"
          label="System password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoFocus
          disabled={loading}
          size="small"
          InputLabelProps={{ shrink: true }}
        />

        <PrimaryButton
          type="submit"
          fullWidth
          loading={loading}
          disabled={!password.trim()}
        >
          Unlock
        </PrimaryButton>

        <Typography variant="caption" color="text.secondary" textAlign="center" sx={{ mt: 1 }}>
          Or run <code>agenshield start</code> in your terminal to open an authenticated session.
        </Typography>
      </Box>
    </Box>
  );
}
