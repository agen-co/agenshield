/**
 * Step 3: Confirmation — preview what will happen before starting setup
 */

import { Box, Typography, Button, Card, CardContent, Alert } from '@mui/material';
import { useSnapshot } from 'valtio';
import { Shield, User, Folder, AlertCircle, ArrowLeft } from 'lucide-react';
import { setupStore } from '../../state/setup';
import { slideIn } from '../../styles/animations';

interface ConfirmStepProps {
  onConfirm: () => void;
  onBack: () => void;
}

export function ConfirmStep({ onConfirm, onBack }: ConfirmStepProps) {
  const { context, mode, baseName } = useSnapshot(setupStore);

  const presetName = (context?.presetName as string) || 'Unknown';
  const detection = context?.presetDetection as Record<string, unknown> | undefined;
  const effectiveBase = baseName || 'default';
  const prefix = 'ash_';

  return (
    <Box sx={{ animation: `${slideIn} 0.3s ease-out` }}>
      <Typography variant="h5" fontWeight={700} gutterBottom>
        Confirm Setup
      </Typography>
      <Typography variant="body1" color="text.secondary" sx={{ mb: 3, lineHeight: 1.6 }}>
        Review the configuration below. AgenShield will create users, groups, and security layers on your system.
      </Typography>

      {/* Target */}
      <Card sx={{ mb: 2 }}>
        <CardContent>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
            <Shield size={16} />
            <Typography variant="subtitle2" color="text.secondary">Target Application</Typography>
          </Box>
          <Box sx={{ display: 'flex', gap: 1, py: 0.5 }}>
            <Typography variant="body2" color="text.secondary" sx={{ minWidth: 140 }}>Application</Typography>
            <Typography variant="body2" fontFamily="monospace">{presetName}</Typography>
          </Box>
          {!!detection?.version && (
            <Box sx={{ display: 'flex', gap: 1, py: 0.5 }}>
              <Typography variant="body2" color="text.secondary" sx={{ minWidth: 140 }}>Version</Typography>
              <Typography variant="body2" fontFamily="monospace">{detection.version as string}</Typography>
            </Box>
          )}
          <Box sx={{ display: 'flex', gap: 1, py: 0.5 }}>
            <Typography variant="body2" color="text.secondary" sx={{ minWidth: 140 }}>Mode</Typography>
            <Typography variant="body2" fontFamily="monospace">{mode === 'quick' ? 'Quick' : 'Advanced'}</Typography>
          </Box>
        </CardContent>
      </Card>

      {/* Users & Groups */}
      <Card sx={{ mb: 2 }}>
        <CardContent>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
            <User size={16} />
            <Typography variant="subtitle2" color="text.secondary">Users & Groups</Typography>
          </Box>
          {[
            { label: 'Agent user', value: `${prefix}${effectiveBase}_agent` },
            { label: 'Broker user', value: `${prefix}${effectiveBase}_broker` },
            { label: 'Socket group', value: `${prefix}${effectiveBase}` },
            { label: 'Workspace group', value: `${prefix}${effectiveBase}_workspace` },
          ].map(({ label, value }) => (
            <Box key={label} sx={{ display: 'flex', gap: 1, py: 0.5 }}>
              <Typography variant="body2" color="text.secondary" sx={{ minWidth: 140 }}>{label}</Typography>
              <Typography variant="body2" fontFamily="monospace">{value}</Typography>
            </Box>
          ))}
        </CardContent>
      </Card>

      {/* Directories */}
      <Card sx={{ mb: 2 }}>
        <CardContent>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
            <Folder size={16} />
            <Typography variant="subtitle2" color="text.secondary">Directories & Services</Typography>
          </Box>
          {[
            { label: 'Config', value: '/opt/agenshield/config' },
            { label: 'Socket', value: '/var/run/agenshield' },
            { label: 'Seatbelt', value: 'macOS sandbox profiles' },
            { label: 'LaunchDaemon', value: 'com.agenshield.broker.plist' },
          ].map(({ label, value }) => (
            <Box key={label} sx={{ display: 'flex', gap: 1, py: 0.5 }}>
              <Typography variant="body2" color="text.secondary" sx={{ minWidth: 140 }}>{label}</Typography>
              <Typography variant="body2" fontFamily="monospace">{value}</Typography>
            </Box>
          ))}
        </CardContent>
      </Card>

      <Alert severity="warning" icon={<AlertCircle size={18} />} sx={{ mb: 2 }}>
        This will create system users, groups, and directories. Requires root privileges.
        You can reverse this later with <code>agenshield uninstall</code>.
      </Alert>

      <Box sx={{ display: 'flex', gap: 1.5, mt: 3 }}>
        <Button
          variant="outlined"
          onClick={onBack}
          startIcon={<ArrowLeft size={16} />}
          sx={{ textTransform: 'none' }}
        >
          Back
        </Button>
        <Button
          variant="contained"
          color="success"
          size="large"
          onClick={onConfirm}
          startIcon={<Shield size={18} />}
          sx={{ textTransform: 'none', fontWeight: 700 }}
        >
          Start Setup
        </Button>
      </Box>
    </Box>
  );
}
