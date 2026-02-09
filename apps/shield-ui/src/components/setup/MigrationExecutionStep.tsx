/**
 * Step 6: Migration Execution — shows progress of select-items, migrate, verify
 */

import { useMemo, useRef, useEffect } from 'react';
import {
  Box, Typography, LinearProgress, List, ListItem,
  ListItemIcon, ListItemText,
} from '@mui/material';
import { useSnapshot } from 'valtio';
import { CheckCircle, XCircle, Loader, Circle } from 'lucide-react';
import { setupStore } from '../../state/setup';
import { slideIn } from '../../styles/animations';
import { slowSpin } from '../../styles/setup-animations';

const MIGRATION_STEP_IDS = ['select-items', 'migrate', 'verify'];

export function MigrationExecutionStep() {
  const { wizardState } = useSnapshot(setupStore);

  const migrationSteps = useMemo(() => {
    if (!wizardState?.steps) return [];
    return wizardState.steps.filter(s => MIGRATION_STEP_IDS.includes(s.id));
  }, [wizardState]);

  const runningRef = useRef<HTMLLIElement | null>(null);
  const runningId = migrationSteps.find(s => s.status === 'running')?.id;

  useEffect(() => {
    if (runningId) {
      const t = setTimeout(() => {
        runningRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }, 50);
      return () => clearTimeout(t);
    }
  }, [runningId]);

  const completed = migrationSteps.filter(s => s.status === 'completed').length;
  const total = migrationSteps.length;
  const progress = total > 0 ? (completed / total) * 100 : 0;
  const hasError = migrationSteps.some(s => s.status === 'error');

  return (
    <Box sx={{ animation: `${slideIn} 0.3s ease-out` }}>
      <Typography variant="h5" fontWeight={700} gutterBottom>
        Migrating
      </Typography>
      <Typography variant="body1" color="text.secondary" sx={{ mb: 3, lineHeight: 1.6 }}>
        {hasError
          ? 'An error occurred during migration. Check the details below.'
          : completed === total
            ? 'Migration completed successfully!'
            : `Copying selected items to sandbox... ${completed} of ${total} steps complete.`}
      </Typography>

      <LinearProgress
        variant="determinate"
        value={progress}
        color={hasError ? 'error' : 'primary'}
        sx={{ mb: 3, height: 6, borderRadius: 1 }}
      />

      <List dense disablePadding>
        {migrationSteps.map((step) => (
          <ListItem
            key={step.id}
            ref={step.id === runningId ? runningRef : undefined}
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
