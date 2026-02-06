import { TextField, Grid2 as Grid, Card, Typography, Box } from '@mui/material';
import { useStatus } from '../../api/hooks';

export function AgentIdentityCard() {
  const { data: status } = useStatus();

  const agentUsername = status?.data?.agentUsername ?? 'ash_default_agent';
  const workspaceGroup = status?.data?.workspaceGroup ?? 'ash_default_workspace';

  return (
    <Card>
      <Typography variant="h6" fontWeight={600}>
        Agent Identity
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
        The username and workspace group this agent is registered under.
      </Typography>
      <Box sx={{ mt: 3 }}>
        <Grid container spacing={3}>
          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField
              label="Agent Username"
              value={agentUsername}
              fullWidth
              InputProps={{ readOnly: true }}
              helperText="Unique identifier for this agent"
              sx={{ '& .MuiInputBase-root': { bgcolor: 'action.hover' } }}
            />
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField
              label="Workspace Group"
              value={workspaceGroup}
              fullWidth
              InputProps={{ readOnly: true }}
              helperText="Group this agent belongs to"
              sx={{ '& .MuiInputBase-root': { bgcolor: 'action.hover' } }}
            />
          </Grid>
        </Grid>
      </Box>

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
          borderBottomLeftRadius: (theme.shape.borderRadius as number) * 2,
          borderBottomRightRadius: (theme.shape.borderRadius as number) * 2,
          bgcolor:
            theme.palette.mode === 'dark'
              ? theme.palette.background.default
              : theme.palette.grey[50],
        })}
      >
        <Typography variant="caption" color="text.secondary">
          Configured during setup. Run agenshield setup to change.
        </Typography>
      </Box>
    </Card>
  );
}
