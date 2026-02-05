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

// Steps to show in the execution view (skip detection-phase steps)
const EXECUTION_STEP_IDS = [
  'backup', 'create-groups', 'create-agent-user', 'create-broker-user',
  'create-directories', 'setup-socket', 'generate-seatbelt', 'install-wrappers',
  'install-broker', 'install-daemon-config', 'install-policies', 'setup-launchdaemon',
  'migrate', 'verify',
];

export function ExecutionStep() {
  const { wizardState } = useSnapshot(setupStore);

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

      <List dense disablePadding sx={{ maxHeight: 400, overflowY: 'auto' }}>
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
                <Loader size={18} color="#3b82f6" style={{ animation: `${slowSpin} 1s linear infinite` }} />
              )}
              {step.status === 'error' && <XCircle size={18} color="#ef4444" />}
              {(step.status === 'pending' || step.status === 'skipped') && <Circle size={18} color="#374151" />}
            </ListItemIcon>
            <ListItemText
              primary={step.name}
              secondary={step.status === 'error' ? step.error : undefined}
              primaryTypographyProps={{
                variant: 'body2',
                color: step.status === 'pending' ? 'text.secondary' : 'text.primary',
              }}
              secondaryTypographyProps={{
                variant: 'caption',
                color: 'error.main',
                fontFamily: 'monospace',
              }}
            />
          </ListItem>
        ))}
      </List>
    </Box>
  );
}
