/**
 * Main App component with routing
 */

import { useState, useMemo, useEffect } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { ThemeProvider, CssBaseline } from '@mui/material';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useSnapshot } from 'valtio';
import { lightTheme, darkTheme } from './theme';
import { Layout } from './components/layout/Layout';
import { Overview } from './pages/Overview';
import { Policies } from './pages/Policies';
import { Skills } from './pages/Skills';
import { Secrets } from './pages/Secrets';
import { Settings } from './pages/Settings';
import { Integrations } from './pages/Integrations';
import { Activity } from './pages/Activity';
import { AuthProvider } from './context/AuthContext';
import { LockBanner } from './components/LockBanner';
import { PageTransition } from './components/layout/PageTransition';
import { PasscodeDialog } from './components/PasscodeDialog';
import { AgentLinkAuthBanner } from './components/agentlink/AgentLinkAuthBanner';
import { useAuth } from './context/AuthContext';
import { useHealth } from './api/hooks';
import { useSSE } from './hooks/useSSE';
import { eventStore } from './state/events';

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
  const { requiresFullAuth, isReadOnly, loaded, passcodeSet, protectionEnabled } = useAuth();
  const { isError: healthError, isLoading: healthLoading, refetch: retryHealth, isFetching } = useHealth();
  const [agentLinkAuthRequired, setAgentLinkAuthRequired] = useState<{ authUrl?: string; integration?: string } | null>(null);

  // Connect to SSE events
  useSSE();

  // Watch for agentlink SSE events
  const { events } = useSnapshot(eventStore);
  useEffect(() => {
    if (events.length === 0) return;
    const latest = events[0];
    if (latest.type === 'agentlink:auth_required') {
      setAgentLinkAuthRequired(latest.data as { authUrl?: string; integration?: string });
    } else if (latest.type === 'agentlink:auth_completed') {
      setAgentLinkAuthRequired(null);
    }
  }, [events]);

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
        disconnected={healthError && !healthLoading}
        onReconnect={() => retryHealth()}
        reconnecting={isFetching}
      >
        {isReadOnly && <LockBanner />}
        <AgentLinkAuthBanner
          authRequired={agentLinkAuthRequired}
          onAuthCompleted={() => setAgentLinkAuthRequired(null)}
        />
        <PageTransition>
          <Routes>
            <Route path="/" element={<Overview />} />
            <Route path="/policies" element={<Policies />} />
            <Route path="/skills" element={<Skills />} />
            <Route path="/secrets" element={<Secrets />} />
            <Route path="/activity" element={<Activity />} />
            <Route path="/integrations" element={<Integrations />} />
            <Route path="/settings" element={<Settings />} />
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
        <AuthProvider>
          <AppContent darkMode={darkMode} onToggleDarkMode={toggleDarkMode} />
        </AuthProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
