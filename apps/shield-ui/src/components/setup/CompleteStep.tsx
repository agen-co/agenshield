/**
 * Step 6: Complete — success summary with final secured graph
 */

import { Box, Typography, Card, CardContent, Alert, Chip } from '@mui/material';
import { useSnapshot } from 'valtio';
import { CheckCircle, Shield, Terminal } from 'lucide-react';
import { setupStore } from '../../state/setup';
import { slideIn } from '../../styles/animations';

export function CompleteStep() {
  const { wizardState, context } = useSnapshot(setupStore);

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
          <Typography variant="body2" color="text.secondary">
            Once the daemon is running, access the full security dashboard at{' '}
            <Chip label="http://localhost:6969" size="small" variant="outlined" />{' '}
            to manage policies, monitor activity, and configure integrations.
          </Typography>
        </CardContent>
      </Card>
    </Box>
  );
}
