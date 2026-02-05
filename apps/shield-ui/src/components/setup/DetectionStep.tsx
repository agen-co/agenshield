/**
 * Step 0: Detection — shows what was detected during the detection phase
 */

import { useEffect } from 'react';
import { Box, Typography, Button, Card, CardContent, Chip } from '@mui/material';
import { CheckCircle, AlertCircle, ArrowRight } from 'lucide-react';
import { useSnapshot } from 'valtio';
import { setupStore } from '../../state/setup';
import { useSetupState } from '../../api/setup';
import { slideIn } from '../../styles/animations';

interface DetectionStepProps {
  onNext: () => void;
}

export function DetectionStep({ onNext }: DetectionStepProps) {
  const { data } = useSetupState();
  const { context } = useSnapshot(setupStore);

  // Hydrate store from initial API call
  useEffect(() => {
    if (data?.data) {
      setupStore.wizardState = data.data.state as never;
      setupStore.context = data.data.context;
    }
  }, [data]);

  const ctx = context || data?.data?.context;
  const presetName = (ctx?.presetName as string) || 'Unknown';
  const detection = ctx?.presetDetection as Record<string, unknown> | undefined;
  const found = detection?.found;

  return (
    <Box sx={{ animation: `${slideIn} 0.3s ease-out` }}>
      <Typography variant="h5" fontWeight={700} gutterBottom>
        Target Detection
      </Typography>
      <Typography variant="body1" color="text.secondary" sx={{ mb: 3, lineHeight: 1.6 }}>
        AgenShield scanned your system for supported applications to sandbox.
      </Typography>

      <Card sx={{ mb: 2 }}>
        <CardContent>
          {!!found ? (
            <>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 2 }}>
                <CheckCircle size={22} color="#22c55e" />
                <Typography variant="h6" fontWeight={600}>{presetName}</Typography>
                <Chip label="Detected" color="success" size="small" />
              </Box>

              {!!detection?.version && (
                <Box sx={{ display: 'flex', gap: 1, py: 0.5 }}>
                  <Typography variant="body2" color="text.secondary" sx={{ minWidth: 80 }}>Version</Typography>
                  <Typography variant="body2" fontFamily="monospace">{detection.version as string}</Typography>
                </Box>
              )}
              {!!detection?.method && (
                <Box sx={{ display: 'flex', gap: 1, py: 0.5 }}>
                  <Typography variant="body2" color="text.secondary" sx={{ minWidth: 80 }}>Method</Typography>
                  <Typography variant="body2" fontFamily="monospace">{detection.method as string}</Typography>
                </Box>
              )}
              {!!detection?.binaryPath && (
                <Box sx={{ display: 'flex', gap: 1, py: 0.5 }}>
                  <Typography variant="body2" color="text.secondary" sx={{ minWidth: 80 }}>Binary</Typography>
                  <Typography variant="body2" fontFamily="monospace">{detection.binaryPath as string}</Typography>
                </Box>
              )}
              {!!detection?.packagePath && (
                <Box sx={{ display: 'flex', gap: 1, py: 0.5 }}>
                  <Typography variant="body2" color="text.secondary" sx={{ minWidth: 80 }}>Package</Typography>
                  <Typography variant="body2" fontFamily="monospace">{detection.packagePath as string}</Typography>
                </Box>
              )}
            </>
          ) : (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
              <AlertCircle size={22} color="#ef4444" />
              <Typography variant="h6" fontWeight={600}>No target detected</Typography>
            </Box>
          )}
        </CardContent>
      </Card>

      {!!found && (
        <Button
          variant="contained"
          size="large"
          onClick={onNext}
          endIcon={<ArrowRight size={18} />}
          sx={{ mt: 2, textTransform: 'none', fontWeight: 600 }}
        >
          Continue
        </Button>
      )}
    </Box>
  );
}
