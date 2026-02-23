import { TextField, Grid2 as Grid, Card, Typography, Box } from '@mui/material';
import { useStatus, useProfiles } from '../../api/hooks';

export function AgentIdentityCard({ profileId }: { profileId?: string | null }) {
  const { data: status } = useStatus();
  const { data: profilesData } = useProfiles();

  // Resolve profile by ID
  const profile = profileId
    ? profilesData?.data?.find(p => p.id === profileId)
    : undefined;

  // When we have a target profile, show its identity; otherwise fall back to global
  const agentUsername = profile?.agentUsername ?? status?.data?.agentUsername ?? 'ash_default_agent';
  const agentUid = profile?.agentUid;
  const agentHomeDir = profile?.agentHomeDir;
  const brokerUsername = profile?.brokerUsername;
  const brokerHomeDir = profile?.brokerHomeDir;

  return (
    <Card>
      <Typography variant="h6" fontWeight={600}>
        {profile ? 'Target Identity' : 'Agent Identity'}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
        {profile
          ? 'The agent and broker identity configured for this target.'
          : 'The username this agent is registered under.'}
      </Typography>
      <Box sx={{ mt: 3 }}>
        <Grid container spacing={3}>
          {/* Row 1: Agent Username + Broker Username */}
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
          {brokerUsername != null && (
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                label="Broker Username"
                value={brokerUsername}
                fullWidth
                InputProps={{ readOnly: true }}
                helperText="Broker user for this target"
                sx={{ '& .MuiInputBase-root': { bgcolor: 'action.hover' } }}
              />
            </Grid>
          )}

          {/* Row 2 (target only): Agent UID + Agent Home Dir */}
          {profile && (
            <>
              <Grid size={{ xs: 12, sm: 6 }}>
                <TextField
                  label="Agent UID"
                  value={agentUid != null ? String(agentUid) : '—'}
                  fullWidth
                  InputProps={{ readOnly: true }}
                  helperText="System UID for the agent user"
                  sx={{ '& .MuiInputBase-root': { bgcolor: 'action.hover' } }}
                />
              </Grid>
              <Grid size={{ xs: 12, sm: 6 }}>
                <TextField
                  label="Agent Home Dir"
                  value={agentHomeDir ?? '—'}
                  fullWidth
                  InputProps={{ readOnly: true }}
                  helperText="Home directory for the agent user"
                  sx={{ '& .MuiInputBase-root': { bgcolor: 'action.hover' } }}
                />
              </Grid>
            </>
          )}

          {/* Row 3 (target only): Broker Home Dir */}
          {profile && brokerHomeDir != null && (
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                label="Broker Home Dir"
                value={brokerHomeDir}
                fullWidth
                InputProps={{ readOnly: true }}
                helperText="Home directory for the broker user"
                sx={{ '& .MuiInputBase-root': { bgcolor: 'action.hover' } }}
              />
            </Grid>
          )}
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
