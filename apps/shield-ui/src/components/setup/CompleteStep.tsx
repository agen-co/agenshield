/**
 * Step 6: Complete — success summary with final secured graph
 */

import { useState, useEffect } from 'react';
import { Box, Typography, Card, CardContent, Alert, Chip, Snackbar, Button } from '@mui/material';
import { useSnapshot } from 'valtio';
import { CheckCircle, Shield, Terminal, ExternalLink, Loader } from 'lucide-react';
import { setupStore } from '../../state/setup';
import { useServerMode } from '../../api/hooks';
import { slideIn, spin } from '../../styles/animations';

const DASHBOARD_URL = 'http://localhost:6969';

export function CompleteStep() {
  const { wizardState, context } = useSnapshot(setupStore);
  const serverMode = useServerMode();
  const [daemonReady, setDaemonReady] = useState(false);

  useEffect(() => {
    if (serverMode === 'daemon') {
      setDaemonReady(true);
    }
  }, [serverMode]);

  const completedSteps = wizardState?.steps?.filter(s => s.status === 'completed').length || 0;
  const passcodeConfigured = (context?.passcodeSetup as Record<string, unknown>)?.configured;
  const wrappersInstalled = (context?.wrappersInstalled as string[]) || [];

  return (
    <Box sx={{ animation: `${slideIn} 0.3s ease-out` }}>
      <Alert
        severity="success"
        icon={<CheckCircle size={28} />}
        sx={{ mb: 3, py: 2, '& .MuiAlert-message': { fontSize: '1.1rem' } }}
      >
        <Typography variant="h6" fontWeight={700}>Setup Complete</Typography>
        <Typography variant="body2" color="text.secondary">
          AgenShield is now protecting your system.
        </Typography>
      </Alert>

      {/* Stats grid */}
      <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2, mb: 3 }}>
        {[
          { value: String(completedSteps), label: 'Steps completed' },
          { value: String(wrappersInstalled.length), label: 'Command wrappers' },
          { value: passcodeConfigured ? 'Yes' : 'Skipped', label: 'Passcode' },
          { value: 'Active', label: 'Seatbelt profiles' },
        ].map(({ value, label }) => (
          <Card key={label}>
            <CardContent sx={{ textAlign: 'center', py: 2 }}>
              <Typography variant="h4" fontWeight={700} color="success.main" fontFamily="monospace">
                {value}
              </Typography>
              <Typography variant="caption" color="text.secondary">{label}</Typography>
            </CardContent>
          </Card>
        ))}
      </Box>

      {/* Next steps */}
      <Card sx={{ mb: 2 }}>
        <CardContent>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
            <Terminal size={16} />
            <Typography variant="subtitle2" color="text.secondary">Next Steps</Typography>
          </Box>

          <Box sx={{ bgcolor: 'action.hover', borderRadius: 1, px: 2, py: 1.5, mb: 1, fontFamily: 'monospace' }}>
            <Typography variant="body2" fontFamily="monospace" color="success.main">
              <Typography component="span" color="text.secondary" fontFamily="monospace">$ </Typography>
              agenshield status
            </Typography>
          </Box>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Check the current security status and verify all protections are active.
          </Typography>

          <Box sx={{ bgcolor: 'action.hover', borderRadius: 1, px: 2, py: 1.5, mb: 1, fontFamily: 'monospace' }}>
            <Typography variant="body2" fontFamily="monospace" color="success.main">
              <Typography component="span" color="text.secondary" fontFamily="monospace">$ </Typography>
              agenshield doctor
            </Typography>
          </Box>
          <Typography variant="body2" color="text.secondary">
            Run diagnostics to ensure everything is working correctly.
          </Typography>
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
            <Shield size={16} />
            <Typography variant="subtitle2" color="text.secondary">Security Dashboard</Typography>
          </Box>
          {daemonReady ? (
            <Typography variant="body2" color="text.secondary">
              The daemon is running. Click{' '}
              <Chip
                label="Open Dashboard"
                size="small"
                color="success"
                icon={<ExternalLink size={14} />}
                onClick={() => window.location.replace(DASHBOARD_URL)}
                clickable
                sx={{ cursor: 'pointer' }}
              />{' '}
              to access the full security dashboard.
            </Typography>
          ) : (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
              <Box component="span" sx={{ display: 'flex', animation: `${spin} 1.5s linear infinite` }}>
                <Loader size={16} />
              </Box>
              <Typography variant="body2" color="text.secondary">
                Waiting for daemon to start at{' '}
                <Chip label={DASHBOARD_URL} size="small" variant="outlined" />{' '}
                …
              </Typography>
            </Box>
          )}
        </CardContent>
      </Card>

      {/* Snackbar popup when daemon becomes ready */}
      <Snackbar
        open={daemonReady}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
        message="Daemon is up and running!"
        action={
          <Button
            color="inherit"
            size="small"
            startIcon={<ExternalLink size={14} />}
            onClick={() => window.location.replace(DASHBOARD_URL)}
          >
            Open Dashboard
          </Button>
        }
      />
    </Box>
  );
}
