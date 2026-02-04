import { Typography, Button, Box } from '@mui/material';
import { ShieldOff, RefreshCw } from 'lucide-react';
import { Root, IconContainer, PulseRing } from './ConnectionError.styles';

interface ConnectionErrorProps {
  onRetry: () => void;
  retrying?: boolean;
}

export function ConnectionError({ onRetry, retrying }: ConnectionErrorProps) {
  return (
    <Root>
      <PulseRing>
        <IconContainer>
          <ShieldOff size={36} />
        </IconContainer>
      </PulseRing>

      <Box>
        <Typography variant="h5" fontWeight={600} gutterBottom>
          Unable to connect to AgenShield
        </Typography>
        <Typography variant="body1" color="text.secondary" sx={{ maxWidth: 440, mx: 'auto' }}>
          The AgenShield daemon is not running or is unreachable. Make sure the daemon is started
          and listening on the expected port.
        </Typography>
      </Box>

      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, alignItems: 'center' }}>
        <Button
          variant="contained"
          startIcon={<RefreshCw size={16} />}
          onClick={onRetry}
          disabled={retrying}
        >
          {retrying ? 'Retrying...' : 'Retry Connection'}
        </Button>

        <Typography variant="caption" color="text.secondary">
          Run <Box component="code" sx={{ bgcolor: 'action.hover', px: 0.75, py: 0.25, borderRadius: 0.5, fontSize: 12 }}>nx serve shield-daemon</Box> to start the daemon
        </Typography>
      </Box>
    </Root>
  );
}
