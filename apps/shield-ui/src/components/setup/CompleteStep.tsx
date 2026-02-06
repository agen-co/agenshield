/**
 * Step 6: Complete — auto-redirect to dashboard
 */

import { useState, useEffect } from 'react';
import { Box, Typography } from '@mui/material';
import { Shield, Loader } from 'lucide-react';
import { useServerMode } from '../../api/hooks';
import { spin } from '../../styles/animations';

const DASHBOARD_URL = 'http://localhost:5200';

export function CompleteStep() {
  const serverMode = useServerMode();
  const [daemonReady, setDaemonReady] = useState(false);

  useEffect(() => {
    if (serverMode === 'daemon') {
      setDaemonReady(true);
    }
  }, [serverMode]);

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
        {daemonReady ? 'Redirecting to dashboard...' : 'Starting AgenShield daemon...'}
      </Typography>
    </Box>
  );
}
