/**
 * Main App component with routing
 */

import React, { useState, useMemo } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { ThemeProvider, CssBaseline } from '@mui/material';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { lightTheme, darkTheme } from './theme';
import { Layout } from './components/layout/Layout';
import { Overview } from './pages/Overview';
import { Policies } from './pages/Policies';
import { Skills } from './pages/Skills';
import { Secrets } from './pages/Secrets';
import { Settings } from './pages/Settings';
import { AuthProvider } from './context/AuthContext';
import { LockBanner } from './components/LockBanner';
import { PasscodeDialog } from './components/PasscodeDialog';
import { ConnectionError } from './components/shared/ConnectionError';
import { useAuth } from './context/AuthContext';
import { useHealth } from './api/hooks';
import { useSSE } from './hooks/useSSE';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 5000,
    },
  },
});

/**
 * Inner app that has access to auth context
 */
function AppContent({ darkMode, onToggleDarkMode }: { darkMode: boolean; onToggleDarkMode: () => void }) {
  const { requiresAuth, loaded, passcodeSet, protectionEnabled } = useAuth();
  const { isError: healthError, isLoading: healthLoading, refetch: retryHealth, isFetching } = useHealth();

  // Connect to SSE events
  useSSE();

  const showConnectionError = healthError && !healthLoading;

  return (
    <BrowserRouter>
      <Layout darkMode={darkMode} onToggleDarkMode={onToggleDarkMode}>
        {showConnectionError ? (
          <ConnectionError onRetry={() => retryHealth()} retrying={isFetching} />
        ) : (
          <>
            <LockBanner />
            <Routes>
              <Route path="/" element={<Overview />} />
              <Route path="/policies" element={<Policies />} />
              <Route path="/skills" element={<Skills />} />
              <Route path="/secrets" element={<Secrets />} />
              <Route path="/settings" element={<Settings />} />
            </Routes>
          </>
        )}
      </Layout>

      {/* Show passcode dialog when protection is enabled but not authenticated */}
      {loaded && requiresAuth && (
        <PasscodeDialog open={true} mode="unlock" />
      )}

      {/* Show setup dialog when protection is enabled but no passcode set */}
      {loaded && protectionEnabled && !passcodeSet && (
        <PasscodeDialog open={true} mode="setup" />
      )}
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
        <AuthProvider>
          <AppContent darkMode={darkMode} onToggleDarkMode={toggleDarkMode} />
        </AuthProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
