/**
 * Step 4: Execution — shows real-time progress of setup steps via SSE
 */

import { useMemo } from 'react';
import {
  Box, Typography, LinearProgress, List, ListItem,
  ListItemIcon, ListItemText,
} from '@mui/material';
import { useSnapshot } from 'valtio';
import { CheckCircle, XCircle, Loader, Circle } from 'lucide-react';
import { setupStore } from '../../state/setup';
import { slideIn } from '../../styles/animations';
import { slowSpin } from '../../styles/setup-animations';

// Steps to show in the execution view (all setup-phase steps)
const EXECUTION_STEP_IDS = [
  'cleanup-previous',
  'create-groups', 'create-agent-user', 'create-broker-user',
  'create-directories', 'setup-socket',
  'install-homebrew', 'install-nvm', 'configure-shell',
  'install-wrappers', 'generate-seatbelt',
  'install-broker', 'install-daemon-config', 'install-policies',
  'setup-launchdaemon',
  'copy-openclaw-config', 'install-openclaw',
  'stop-host-openclaw', 'onboard-openclaw',
  'verify', 'start-openclaw',
];

export function ExecutionStep() {
  const { wizardState, stepLogs } = useSnapshot(setupStore);

  const executionSteps = useMemo(() => {
    if (!wizardState?.steps) return [];
    return wizardState.steps.filter(s => EXECUTION_STEP_IDS.includes(s.id));
  }, [wizardState]);

  const completed = executionSteps.filter(s => s.status === 'completed').length;
  const total = executionSteps.length;
  const progress = total > 0 ? (completed / total) * 100 : 0;
  const hasError = executionSteps.some(s => s.status === 'error');

  return (
    <Box sx={{ animation: `${slideIn} 0.3s ease-out` }}>
      <Typography variant="h5" fontWeight={700} gutterBottom>
        Installing
      </Typography>
      <Typography variant="body1" color="text.secondary" sx={{ mb: 3, lineHeight: 1.6 }}>
        {hasError
          ? 'An error occurred during setup. Check the details below.'
          : completed === total
            ? 'All steps completed successfully!'
            : `Setting up security layers... ${completed} of ${total} steps complete.`}
      </Typography>

      <LinearProgress
        variant="determinate"
        value={progress}
        color={hasError ? 'error' : 'primary'}
        sx={{ mb: 3, height: 6, borderRadius: 1 }}
      />

      <List dense disablePadding>
        {executionSteps.map((step) => (
          <ListItem
            key={step.id}
            sx={{
              borderRadius: 1,
              mb: 0.25,
              bgcolor: step.status === 'running'
                ? 'action.hover'
                : step.status === 'error'
                  ? 'error.main'
                  : 'transparent',
              ...(step.status === 'error' && { bgcolor: 'rgba(239,68,68,0.06)' }),
            }}
          >
            <ListItemIcon sx={{ minWidth: 32 }}>
              {step.status === 'completed' && <CheckCircle size={18} color="#22c55e" />}
              {step.status === 'running' && (
                <Box component="span" sx={{ display: 'inline-flex', animation: `${slowSpin} 1s linear infinite` }}>
                  <Loader size={18} color="#3b82f6" />
                </Box>
              )}
              {step.status === 'error' && <XCircle size={18} color="#ef4444" />}
              {(step.status === 'pending' || step.status === 'skipped') && <Circle size={18} color="#374151" />}
            </ListItemIcon>
            <ListItemText
              primary={step.name}
              secondary={
                step.status === 'error'
                  ? step.error
                  : step.status === 'running'
                    ? stepLogs[step.id] || step.description
                    : undefined
              }
              primaryTypographyProps={{
                variant: 'body2',
                color: step.status === 'pending' ? 'text.secondary' : 'text.primary',
              }}
              secondaryTypographyProps={{
                variant: 'caption',
                color: step.status === 'error' ? 'error.main' : 'text.secondary',
                fontFamily: 'monospace',
                noWrap: true,
                sx: { textOverflow: 'ellipsis', overflow: 'hidden' },
              }}
            />
          </ListItem>
        ))}
      </List>
    </Box>
  );
}
