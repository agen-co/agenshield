/**
 * Main App component with routing
 */

import { useState, useMemo, useEffect, useRef } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { ThemeProvider, CssBaseline } from '@mui/material';
import { QueryClientProvider } from '@tanstack/react-query';
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
import { ProfilesPage } from './pages/ProfilesPage';
import { ProfileDetail } from './pages/ProfileDetail';
import { EnvVars } from './pages/EnvVars';
import { Canvas } from './components/canvas';
import { AuthProvider } from './context/AuthContext';
import { UnlockProvider } from './context/UnlockContext';
import { LockBanner } from './components/LockBanner';
import { PageTransition } from './components/layout/PageTransition';
import { PasscodeDialog } from './components/PasscodeDialog';
import { ShieldRoute } from './components/routing';
import { useAuth } from './context/AuthContext';
import { useHealth, useServerMode } from './api/hooks';
import { useSSE } from './hooks/useSSE';
import { setScope } from './state/scope';
import { setProfileExpanded } from './state/sidebar';
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
  // Connect to SSE events — always connect (setup mode uses SSE for progress)
  // Token triggers SSE reconnect on auth state change (authenticated <-> anonymous)
  useSSE(!!serverMode, token);

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

  // Update mode: render update wizard
  if (serverMode === 'update') {
    return <UpdatePage />;
  }

  // In setup mode, skip all auth gates — go straight to routing
  // (ShieldRoute will redirect non-canvas routes to /canvas)
  if (serverMode === 'setup') {
    return (
      <BrowserRouter>
        <AppRoutes
          darkMode={darkMode}
          onToggleDarkMode={onToggleDarkMode}
          isConfirmedDisconnected={isConfirmedDisconnected}
          retryHealth={retryHealth}
          isFetching={isFetching}
          isReadOnly={false}
          isSetupMode
        />
      </BrowserRouter>
    );
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
      <AppRoutes
        darkMode={darkMode}
        onToggleDarkMode={onToggleDarkMode}
        isConfirmedDisconnected={isConfirmedDisconnected}
        retryHealth={retryHealth}
        isFetching={isFetching}
        isReadOnly={isReadOnly}
      />
    </BrowserRouter>
  );
}

/**
 * Syncs scope store + sidebar expanded state from the URL.
 * Placed inside BrowserRouter so it can read useLocation.
 */
function ScopeSync() {
  const { pathname } = useLocation();
  useEffect(() => {
    const match = pathname.match(/^\/profiles\/([^/]+)/);
    if (match) {
      setScope(match[1]);
      setProfileExpanded(match[1], true);
    } else {
      setScope(null);
    }
  }, [pathname]);
  return null;
}

/**
 * Inner routing component — needs to be inside BrowserRouter to use useLocation
 */
function AppRoutes({
  darkMode,
  onToggleDarkMode,
  isConfirmedDisconnected,
  retryHealth,
  isFetching,
  isReadOnly,
  isSetupMode,
}: {
  darkMode: boolean;
  onToggleDarkMode: () => void;
  isConfirmedDisconnected: boolean;
  retryHealth: () => void;
  isFetching: boolean;
  isReadOnly: boolean;
  isSetupMode?: boolean;
}) {
  const location = useLocation();
  const isCanvasRoute = location.pathname === '/canvas';

  return (
    <Layout
      darkMode={darkMode}
      onToggleDarkMode={onToggleDarkMode}
      disconnected={isConfirmedDisconnected}
      onReconnect={() => retryHealth()}
      reconnecting={isFetching}
      fullBleed={isCanvasRoute}
      hideSidebar={isSetupMode}
    >
      {!isSetupMode && <ScopeSync />}
      {isReadOnly && !isCanvasRoute && !isSetupMode && <LockBanner />}
      <PageTransition>
        <Routes>
          {/* Canvas — always available (setup panel lives here) */}
          <Route path="/canvas" element={
            <ShieldRoute allowedModes={['any']}><Canvas /></ShieldRoute>
          } />

          {/* Daemon-only routes — redirect to /canvas in setup mode */}
          <Route path="/" element={
            <ShieldRoute allowedModes={['daemon']}><Overview /></ShieldRoute>
          } />
          <Route path="/policies" element={
            <ShieldRoute allowedModes={['daemon']}><Navigate to="/policies/commands" replace /></ShieldRoute>
          } />
          <Route path="/policies/:tab" element={
            <ShieldRoute allowedModes={['daemon']}><Policies /></ShieldRoute>
          } />
          <Route path="/skills" element={
            <ShieldRoute allowedModes={['daemon']}><Skills /></ShieldRoute>
          } />
          <Route path="/skills/:id" element={
            <ShieldRoute allowedModes={['daemon']}><SkillPage /></ShieldRoute>
          } />
          <Route path="/secrets" element={
            <ShieldRoute allowedModes={['daemon']}><Secrets /></ShieldRoute>
          } />
          <Route path="/activity" element={
            <ShieldRoute allowedModes={['daemon']}><Activity /></ShieldRoute>
          } />
          <Route path="/integrations" element={
            <ShieldRoute allowedModes={['daemon']}><Integrations /></ShieldRoute>
          } />
          <Route path="/settings" element={
            <ShieldRoute allowedModes={['daemon']}><Settings /></ShieldRoute>
          } />
          <Route path="/profiles" element={
            <ShieldRoute allowedModes={['daemon']}><ProfilesPage /></ShieldRoute>
          } />
          <Route path="/profiles/:profileId" element={
            <ShieldRoute allowedModes={['daemon']}><ProfileDetail /></ShieldRoute>
          } />
          <Route path="/profiles/:profileId/policies" element={
            <ShieldRoute allowedModes={['daemon']}><Navigate to="commands" replace /></ShieldRoute>
          } />
          <Route path="/profiles/:profileId/policies/:tab" element={
            <ShieldRoute allowedModes={['daemon']}><Policies /></ShieldRoute>
          } />
          <Route path="/profiles/:profileId/skills" element={
            <ShieldRoute allowedModes={['daemon']}><Skills /></ShieldRoute>
          } />
          <Route path="/profiles/:profileId/secrets" element={
            <ShieldRoute allowedModes={['daemon']}><Secrets /></ShieldRoute>
          } />
          <Route path="/profiles/:profileId/env" element={
            <ShieldRoute allowedModes={['daemon']}><EnvVars /></ShieldRoute>
          } />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </PageTransition>
    </Layout>
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
