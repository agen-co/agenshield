/**
 * Main App component with routing
 *
 * Canvas is the primary view and entry point. All navigation is canvas-first:
 * sub-pages render as overlays at /<page>/<tab>.
 */

import { useState, useMemo, useEffect, useRef } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { ThemeProvider, CssBaseline, GlobalStyles, Box, Typography, TextField, Button, Alert, IconButton, Tooltip } from '@mui/material';
import { QueryClientProvider } from '@tanstack/react-query';
import { Shield, Terminal, Copy, Check } from 'lucide-react';
import { lightTheme, darkTheme } from './theme';
import { Layout } from './components/layout/Layout';
import { Canvas } from './components/canvas';
import { AuthProvider, useAuth } from './context/AuthContext';
import { useHealth } from './api/hooks';
import { useSSE } from './hooks/useSSE';
import { useMetricsBackfill } from './hooks/useMetricsBackfill';
import { Notifications } from './components/shared/Notifications';
import { queryClient } from './api/query-client';

/**
 * Locked screen — shown when not authenticated.
 * Two options: run CLI command or enter sudo password.
 */
function LockScreen() {
  const { loginWithSudo } = useAuth();
  const [mode, setMode] = useState<'choice' | 'sudo'>('choice');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleSudoSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password) return;
    setError(null);
    setLoading(true);
    try {
      const result = await loginWithSudo(username, password);
      if (!result.success) {
        setError(result.error || 'Authentication failed');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = () => {
    navigator.clipboard.writeText('agenshield start').then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
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
        sx={{
          width: 400,
          maxWidth: '90vw',
          p: 4,
          borderRadius: 2,
          bgcolor: 'background.paper',
          border: 1,
          borderColor: 'divider',
          boxShadow: (theme) => `0 8px 32px ${theme.palette.mode === 'dark' ? 'rgba(0,0,0,0.6)' : 'rgba(0,0,0,0.12)'}`,
        }}
      >
        {/* Shield logo + title */}
        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', mb: 3 }}>
          <Shield size={40} strokeWidth={1.5} style={{ opacity: 0.4, marginBottom: 12 }} />
          <Typography variant="h6" fontWeight={700}>
            AgenShield
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            Authentication required
          </Typography>
        </Box>

        {mode === 'choice' && (
          <>
            {/* Option 1: CLI command */}
            <Box
              sx={{
                p: 2,
                mb: 2,
                borderRadius: 1,
                border: 1,
                borderColor: 'divider',
                bgcolor: (theme) => theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)',
              }}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                <Terminal size={16} />
                <Typography variant="subtitle2">Run this command</Typography>
              </Box>
              <Box
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1,
                  p: 1,
                  borderRadius: 0.5,
                  bgcolor: (theme) => theme.palette.mode === 'dark' ? '#1C1C20' : '#F5F5F5',
                  fontFamily: "'IBM Plex Mono', monospace",
                  fontSize: 13,
                }}
              >
                <code style={{ flex: 1 }}>agenshield start</code>
                <Tooltip title={copied ? 'Copied!' : 'Copy command'}>
                  <IconButton size="small" onClick={handleCopy}>
                    {copied ? <Check size={14} /> : <Copy size={14} />}
                  </IconButton>
                </Tooltip>
              </Box>
            </Box>

            {/* Divider */}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, my: 2 }}>
              <Box sx={{ flex: 1, height: '1px', bgcolor: 'divider' }} />
              <Typography variant="caption" color="text.secondary">or</Typography>
              <Box sx={{ flex: 1, height: '1px', bgcolor: 'divider' }} />
            </Box>

            {/* Option 2: Sudo login */}
            <Button
              fullWidth
              variant="outlined"
              onClick={() => setMode('sudo')}
              sx={{ textTransform: 'none', fontWeight: 600 }}
            >
              Enter sudo password
            </Button>
          </>
        )}

        {mode === 'sudo' && (
          <form onSubmit={handleSudoSubmit} autoComplete="off">
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Enter your macOS credentials to authenticate.
            </Typography>

            {error && (
              <Alert severity="error" sx={{ mb: 2 }}>
                {error}
              </Alert>
            )}

            <TextField
              label="Username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              fullWidth
              autoFocus
              disabled={loading}
              InputLabelProps={{ shrink: true }}
              sx={{ mb: 2 }}
              inputProps={{ autoComplete: 'off' }}
            />

            <TextField
              label="Password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              fullWidth
              disabled={loading}
              InputLabelProps={{ shrink: true }}
              sx={{ mb: 2 }}
              inputProps={{ autoComplete: 'off' }}
            />

            <Box sx={{ display: 'flex', gap: 1 }}>
              <Button
                onClick={() => { setMode('choice'); setError(null); }}
                disabled={loading}
                sx={{ textTransform: 'none' }}
              >
                Back
              </Button>
              <Button
                type="submit"
                variant="contained"
                fullWidth
                disabled={loading || !username.trim() || !password}
                sx={{ textTransform: 'none', fontWeight: 600 }}
              >
                {loading ? 'Verifying...' : 'Authenticate'}
              </Button>
            </Box>
          </form>
        )}
      </Box>
    </Box>
  );
}

/**
 * Inner app that has access to auth context
 */
function AppContent({ darkMode, onToggleDarkMode }: { darkMode: boolean; onToggleDarkMode: () => void }) {
  const { loaded, authenticated, token } = useAuth();
  const { isError: healthError, isLoading: healthLoading, refetch: retryHealth, isFetching, isSuccess } = useHealth();
  // Connect to SSE events — token triggers reconnect on auth state change
  useSSE(true, token);
  // Backfill metrics history from SQLite on mount (global, runs once)
  useMetricsBackfill();

  // Debounce disconnect state: only confirm after 5s of sustained failure
  const disconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [isConfirmedDisconnected, setIsConfirmedDisconnected] = useState(false);

  useEffect(() => {
    if (healthError && !healthLoading) {
      // Start a 5-second timer before confirming disconnect
      if (!disconnectTimer.current) {
        disconnectTimer.current = setTimeout(() => {
          setIsConfirmedDisconnected(true);
        }, 5000);
      }
    } else {
      // Health recovered — clear the timer and reset
      if (disconnectTimer.current) {
        clearTimeout(disconnectTimer.current);
        disconnectTimer.current = null;
      }
      if (isConfirmedDisconnected && isSuccess) {
        // Was confirmed disconnected, now recovered — reload
        console.log('[Dashboard] Server reconnected, refreshing page...');
        window.location.reload();
      }
      setIsConfirmedDisconnected(false);
    }
    return () => {
      if (disconnectTimer.current) {
        clearTimeout(disconnectTimer.current);
      }
    };
  }, [healthError, healthLoading, isSuccess]);

  // Show lock screen when not authenticated
  if (loaded && !authenticated) {
    return (
      <BrowserRouter>
        <LockScreen />
      </BrowserRouter>
    );
  }

  return (
    <BrowserRouter>
      <AppRoutes
        darkMode={darkMode}
        onToggleDarkMode={onToggleDarkMode}
        isConfirmedDisconnected={isConfirmedDisconnected}
        retryHealth={retryHealth}
        isFetching={isFetching}
      />
    </BrowserRouter>
  );
}

/**
 * Inner routing component — Canvas is the root catch-all.
 * Sub-pages (metrics, activity, policies, etc.) are rendered as Canvas overlays.
 */
function AppRoutes({
  darkMode,
  onToggleDarkMode,
  isConfirmedDisconnected,
  retryHealth,
  isFetching,
}: {
  darkMode: boolean;
  onToggleDarkMode: () => void;
  isConfirmedDisconnected: boolean;
  retryHealth: () => void;
  isFetching: boolean;
}) {
  return (
    <Layout
      darkMode={darkMode}
      onToggleDarkMode={onToggleDarkMode}
      disconnected={isConfirmedDisconnected}
      onReconnect={() => retryHealth()}
      reconnecting={isFetching}
      fullBleed
      hideSidebar
    >
      <Routes>
        <Route path="/*" element={<Canvas darkMode={darkMode} onToggleDarkMode={onToggleDarkMode} />} />
      </Routes>
    </Layout>
  );
}

const DARK_MODE_KEY = 'agenshield-dark-mode';

export function App() {
  const [darkMode, setDarkMode] = useState(() => {
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem(DARK_MODE_KEY);
      if (stored !== null) return stored === 'true';
    }
    return true; // default dark
  });

  const theme = useMemo(() => (darkMode ? darkTheme : lightTheme), [darkMode]);

  const toggleDarkMode = () => setDarkMode((prev) => {
    const next = !prev;
    localStorage.setItem(DARK_MODE_KEY, String(next));
    return next;
  });

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <GlobalStyles styles={{
          '@keyframes spin': {
            from: { transform: 'rotate(0deg)' },
            to: { transform: 'rotate(360deg)' },
          },
        }} />
        <Notifications />
        <AuthProvider>
          <AppContent darkMode={darkMode} onToggleDarkMode={toggleDarkMode} />
        </AuthProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
