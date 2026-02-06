/**
 * Step 6: Complete — auto-redirect to dashboard
 *
 * Polls health endpoint every second to detect when daemon is ready,
 * then redirects to the dashboard.
 */

import { useState, useEffect, useRef } from 'react';
import { Box, Typography } from '@mui/material';
import { Shield, Loader } from 'lucide-react';
import { spin } from '../../styles/animations';

const DASHBOARD_URL = 'http://localhost:5200';
const POLL_INTERVAL = 1000; // Poll every second while waiting

export function CompleteStep() {
  const [daemonReady, setDaemonReady] = useState(false);
  const [statusText, setStatusText] = useState('Starting AgenShield daemon...');
  const pollRef = useRef<NodeJS.Timeout | null>(null);

  // Poll health endpoint directly (faster than react-query default interval)
  useEffect(() => {
    const checkHealth = async () => {
      try {
        const response = await fetch('/api/health');
        if (response.ok) {
          const data = await response.json();
          if (data?.data?.mode === 'daemon') {
            setDaemonReady(true);
            setStatusText('Daemon ready! Redirecting...');
            if (pollRef.current) {
              clearInterval(pollRef.current);
              pollRef.current = null;
            }
          }
        }
      } catch {
        // Server not ready yet, keep polling
        setStatusText('Waiting for daemon to start...');
      }
    };

    // Initial check
    checkHealth();

    // Start polling
    pollRef.current = setInterval(checkHealth, POLL_INTERVAL);

    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
      }
    };
  }, []);

  // Auto-redirect when daemon is ready
  useEffect(() => {
    if (daemonReady) {
      const timer = setTimeout(() => {
        window.location.href = DASHBOARD_URL;
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [daemonReady]);

  return (
    <Box sx={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: '100vh',
      gap: 3,
    }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
        <Shield size={32} />
        <Typography variant="h5" fontWeight={700}>AgenShield</Typography>
      </Box>

      <Box sx={{ display: 'flex', animation: `${spin} 1.5s linear infinite` }}>
        <Loader size={32} />
      </Box>

      <Typography variant="body1" color="text.secondary">
        {statusText}
      </Typography>
    </Box>
  );
}
