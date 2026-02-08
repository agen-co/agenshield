import { Box, Card, Chip, Typography, Alert } from '@mui/material';
import { Play, Square, RotateCcw } from 'lucide-react';
import { useOpenClawStatus, useOpenClawAction } from '../../api/hooks';
import PrimaryButton from '../../elements/buttons/PrimaryButton';
import SecondaryButton from '../../elements/buttons/SecondaryButton';
import DangerButton from '../../elements/buttons/DangerButton';

export function OpenClawCard() {
  const { data, isLoading } = useOpenClawStatus();
  const action = useOpenClawAction();

  const gateway = data?.data?.gateway;
  const isRunning = gateway?.running ?? false;

  const handleAction = (type: 'start' | 'stop' | 'restart') => {
    action.mutate(type);
  };

  return (
    <Card>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.5 }}>
        <Typography variant="h6" fontWeight={600}>
          OpenClaw Gateway
        </Typography>
        {!isLoading && (
          <Chip
            label={isRunning ? 'Running' : 'Stopped'}
            color={isRunning ? 'success' : 'error'}
            size="small"
            variant="outlined"
          />
        )}
      </Box>
      <Typography variant="body2" color="text.secondary">
        Manage the OpenClaw gateway service.
        {isRunning && gateway?.pid != null && ` PID: ${gateway.pid}`}
      </Typography>

      {action.error && (
        <Alert severity="error" sx={{ mt: 2 }}>
          {action.error.message}
        </Alert>
      )}

      {/* Footer */}
      <Box
        sx={(theme) => ({
          borderTop: `1px solid ${theme.palette.divider}`,
          mx: -3,
          mb: -3,
          mt: 3,
          px: 3,
          py: 1.5,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'flex-end',
          gap: 1,
          borderBottomLeftRadius: (theme.shape.borderRadius as number) * 2,
          borderBottomRightRadius: (theme.shape.borderRadius as number) * 2,
          bgcolor: theme.palette.mode === 'dark'
            ? theme.palette.background.default
            : theme.palette.grey[50],
        })}
      >
        <PrimaryButton
          size="small"
          startIcon={<Play size={14} />}
          onClick={() => handleAction('start')}
          disabled={isRunning || action.isPending}
          loading={action.isPending && action.variables === 'start'}
        >
          Start
        </PrimaryButton>
        <DangerButton
          size="small"
          startIcon={<Square size={14} />}
          onClick={() => handleAction('stop')}
          disabled={!isRunning || action.isPending}
          loading={action.isPending && action.variables === 'stop'}
        >
          Stop
        </DangerButton>
        <SecondaryButton
          size="small"
          startIcon={<RotateCcw size={14} />}
          onClick={() => handleAction('restart')}
          disabled={!isRunning || action.isPending}
          loading={action.isPending && action.variables === 'restart'}
        >
          Restart
        </SecondaryButton>
      </Box>
    </Card>
  );
}
