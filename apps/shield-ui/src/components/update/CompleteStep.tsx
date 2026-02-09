/**
 * Complete Step — success or failure screen after update finishes
 */

import { Box, Typography, Button, Alert } from '@mui/material';
import { CheckCircle, XCircle, ExternalLink } from 'lucide-react';
import { useSnapshot } from 'valtio';
import { updateStore } from '../../state/update';
import { slideIn } from '../../styles/animations';

export function CompleteStep() {
  const { updateState } = useSnapshot(updateStore);
  const hasError = updateState?.hasError ?? false;
  const failedSteps = updateState?.steps.filter(s => s.status === 'error') ?? [];

  return (
    <Box
      sx={{
        animation: `${slideIn} 0.3s ease-out`,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '60vh',
        textAlign: 'center',
        px: 3,
      }}
    >
      {hasError ? (
        <>
          <XCircle size={56} color="#ef4444" />
          <Typography variant="h4" fontWeight={700} sx={{ mt: 3, mb: 1 }}>
            Update Failed
          </Typography>
          <Typography variant="body1" color="text.secondary" sx={{ mb: 3, maxWidth: 480, lineHeight: 1.6 }}>
            The update encountered errors. Your previous configuration has been preserved.
            You can safely retry the update.
          </Typography>

          {failedSteps.length > 0 && (
            <Box sx={{ mb: 3, width: '100%', maxWidth: 480 }}>
              {failedSteps.map((step) => (
                <Alert key={step.id} severity="error" sx={{ mb: 1, textAlign: 'left' }}>
                  <strong>{step.name}</strong>: {step.error}
                </Alert>
              ))}
            </Box>
          )}

          <Button
            variant="contained"
            size="large"
            onClick={() => window.location.reload()}
            sx={{ textTransform: 'none', fontWeight: 600 }}
          >
            Retry Update
          </Button>
        </>
      ) : (
        <>
          <CheckCircle size={56} color="#22c55e" />
          <Typography variant="h4" fontWeight={700} sx={{ mt: 3, mb: 1 }}>
            Update Complete
          </Typography>
          <Typography variant="body1" color="text.secondary" sx={{ mb: 1 }}>
            {updateState?.fromVersion} &rarr; {updateState?.toVersion}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 3, maxWidth: 480, lineHeight: 1.6 }}>
            AgenShield has been updated successfully. All your users, configurations, and data have been preserved.
            The daemon is now running with the latest version.
          </Typography>

          <Button
            variant="contained"
            size="large"
            href="http://localhost:5200"
            endIcon={<ExternalLink size={16} />}
            sx={{ textTransform: 'none', fontWeight: 600 }}
          >
            Open Dashboard
          </Button>
        </>
      )}
    </Box>
  );
}
