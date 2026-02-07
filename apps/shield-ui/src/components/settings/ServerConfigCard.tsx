import { useState, useEffect, useRef } from 'react';
import { TextField, Grid2 as Grid } from '@mui/material';
import { useConfig, useUpdateConfig } from '../../api/hooks';
import { useGuardedAction } from '../../hooks/useGuardedAction';
import { SettingsCard } from '../shared/SettingsCard';

export function ServerConfigCard() {
  const { data: config } = useConfig();
  const updateConfig = useUpdateConfig();
  const guard = useGuardedAction();

  const [host, setHost] = useState('localhost');
  const [port, setPort] = useState(5200);
  const [saved, setSaved] = useState(false);

  const syncedHost = useRef('localhost');
  const syncedPort = useRef(5200);

  const serverHost = config?.data?.daemon?.host;
  const serverPort = config?.data?.daemon?.port;

  useEffect(() => {
    if (serverHost != null) {
      setHost(serverHost);
      syncedHost.current = serverHost;
    }
  }, [serverHost]);

  useEffect(() => {
    if (serverPort != null) {
      setPort(serverPort);
      syncedPort.current = serverPort;
    }
  }, [serverPort]);

  const hasChanges = host !== syncedHost.current || port !== syncedPort.current;

  const handleSave = () => {
    const daemon = config?.data?.daemon;
    if (!daemon) return;
    updateConfig.mutate(
      { daemon: { ...daemon, host, port } },
      {
        onSuccess: () => {
          syncedHost.current = host;
          syncedPort.current = port;
          setSaved(true);
          setTimeout(() => setSaved(false), 2000);
        },
      }
    );
  };

  return (
    <SettingsCard
      title="Server Configuration"
      description="Configure how the daemon server listens for connections."
      footerInfo="Changes require a daemon restart to take effect."
      onSave={() => guard(handleSave, { description: 'Unlock to save server configuration.', actionLabel: 'Save' })}
      saving={updateConfig.isPending}
      saved={saved}
      hasChanges={hasChanges}
      disabled={!config?.data?.daemon}
      error={updateConfig.error?.message}
    >
      <Grid container spacing={3}>
        <Grid size={{ xs: 12, sm: 6 }}>
          <TextField
            label="Host"
            value={host}
            onChange={(e) => setHost(e.target.value)}
            fullWidth
            helperText="Hostname or IP address to bind to"
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6 }}>
          <TextField
            label="Port"
            type="number"
            value={port}
            onChange={(e) => setPort(parseInt(e.target.value, 10) || 0)}
            fullWidth
            inputProps={{ min: 1, max: 65535 }}
            helperText="Port number (1-65535)"
          />
        </Grid>
      </Grid>
    </SettingsCard>
  );
}
