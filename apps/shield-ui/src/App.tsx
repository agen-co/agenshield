/**
 * Main App component with routing
 *
 * Canvas is the primary view and entry point. All navigation is canvas-first:
 * sub-pages render as overlays at /<page>/<tab>.
 */

import { useState, useMemo, useEffect, useRef } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { ThemeProvider, CssBaseline, GlobalStyles } from '@mui/material';
import { QueryClientProvider } from '@tanstack/react-query';
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
 * Inner app that has access to auth context
 */
function AppContent({ darkMode, onToggleDarkMode }: { darkMode: boolean; onToggleDarkMode: () => void }) {
  const { token } = useAuth();
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
