/**
 * Main App component with routing
 */

import { useState, useMemo, useEffect, useRef } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ThemeProvider, CssBaseline } from '@mui/material';
import { QueryClientProvider } from '@tanstack/react-query';
import { useSnapshot } from 'valtio';
import { lightTheme, darkTheme } from './theme';
import { Layout } from './components/layout/Layout';
import { Overview } from './pages/Overview';
import { Policies } from './pages/Policies';
import { Skills } from './pages/Skills';
import { SkillPage } from './pages/SkillPage';
import { Secrets } from './pages/Secrets';
import { Settings } from './pages/Settings';
import { Integrations } from './pages/Integrations';
import { Activity } from './pages/Activity';
import { AuthProvider } from './context/AuthContext';
import { UnlockProvider } from './context/UnlockContext';
import { LockBanner } from './components/LockBanner';
import { PageTransition } from './components/layout/PageTransition';
import { PasscodeDialog } from './components/PasscodeDialog';
import { useAuth } from './context/AuthContext';
import { useHealth, useServerMode } from './api/hooks';
import { useSSE } from './hooks/useSSE';
import { setupStore } from './state/setup';
import { SetupWizard } from './pages/Setup';
import { UpdatePage } from './pages/Update';
import { NotFound } from './pages/NotFound';
import { Notifications } from './components/shared/Notifications';
import { queryClient } from './api/query-client';

/**
 * Inner app that has access to auth context
 */
function AppContent({ darkMode, onToggleDarkMode }: { darkMode: boolean; onToggleDarkMode: () => void }) {
  const { requiresFullAuth, isReadOnly, loaded, passcodeSet, protectionEnabled, token } = useAuth();
  const { isError: healthError, isLoading: healthLoading, refetch: retryHealth, isFetching, isSuccess } = useHealth();
  const serverMode = useServerMode();
  // Connect to SSE events (skip in setup mode but always call the hook)
  // Token triggers SSE reconnect on auth state change (authenticated ↔ anonymous)
  useSSE(serverMode !== 'setup', token);

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

  // Keep wizard visible while daemon restarts after setup completes
  const { phase: setupPhase } = useSnapshot(setupStore);

  // Setup mode: render full-screen wizard, bypass all auth gates
  if (serverMode === 'setup' || setupPhase === 'complete') {
    return <SetupWizard />;
  }

  // Update mode: render update wizard
  if (serverMode === 'update') {
    return <UpdatePage />;
  }

  // When anonymous read-only is disabled and not authenticated, block the entire UI
  if (loaded && requiresFullAuth) {
    return (
      <BrowserRouter>
        <PasscodeDialog open={true} mode="unlock" fullScreen />
      </BrowserRouter>
    );
  }

  // When protection is enabled but no passcode set yet, show setup
  if (loaded && protectionEnabled && !passcodeSet) {
    return (
      <BrowserRouter>
        <PasscodeDialog open={true} mode="setup" fullScreen />
      </BrowserRouter>
    );
  }

  return (
    <BrowserRouter>
      <Layout
        darkMode={darkMode}
        onToggleDarkMode={onToggleDarkMode}
        disconnected={isConfirmedDisconnected}
        onReconnect={() => retryHealth()}
        reconnecting={isFetching}
      >
        {isReadOnly && <LockBanner />}
        <PageTransition>
          <Routes>
            <Route path="/" element={<Overview />} />
            <Route path="/policies" element={<Navigate to="/policies/commands" replace />} />
            <Route path="/policies/:tab" element={<Policies />} />
            <Route path="/skills" element={<Skills />} />
            <Route path="/skills/:slug" element={<SkillPage />} />
            <Route path="/secrets" element={<Secrets />} />
            <Route path="/activity" element={<Activity />} />
            <Route path="/integrations" element={<Integrations />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </PageTransition>
      </Layout>

    </BrowserRouter>
  );
}

export function App() {
  const [darkMode, setDarkMode] = useState(() => {
    if (typeof window !== 'undefined') {
      return window.matchMedia('(prefers-color-scheme: dark)').matches;
    }
    return false;
  });

  const theme = useMemo(() => (darkMode ? darkTheme : lightTheme), [darkMode]);

  const toggleDarkMode = () => setDarkMode((prev) => !prev);

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <Notifications />
        <AuthProvider>
          <UnlockProvider>
            <AppContent darkMode={darkMode} onToggleDarkMode={toggleDarkMode} />
          </UnlockProvider>
        </AuthProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
