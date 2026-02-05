import { useState, useEffect, useRef } from 'react';
import { FormControl, InputLabel, Select, MenuItem } from '@mui/material';
import type { DaemonConfig } from '@agenshield/ipc';
import { useConfig, useUpdateConfig } from '../../api/hooks';
import { useAuth } from '../../context/AuthContext';
import { SettingsCard } from '../shared/SettingsCard';

export function LoggingCard() {
  const { data: config } = useConfig();
  const updateConfig = useUpdateConfig();
  const { isReadOnly } = useAuth();

  const [logLevel, setLogLevel] = useState<DaemonConfig['logLevel']>('info');
  const [saved, setSaved] = useState(false);

  const syncedLogLevel = useRef<DaemonConfig['logLevel']>('info');

  const serverLogLevel = config?.data?.daemon?.logLevel;

  useEffect(() => {
    if (serverLogLevel != null) {
      setLogLevel(serverLogLevel);
      syncedLogLevel.current = serverLogLevel;
    }
  }, [serverLogLevel]);

  const hasChanges = logLevel !== syncedLogLevel.current;

  const handleSave = () => {
    const daemon = config?.data?.daemon;
    if (!daemon) return;
    updateConfig.mutate(
      { daemon: { ...daemon, logLevel } },
      {
        onSuccess: () => {
          syncedLogLevel.current = logLevel;
          setSaved(true);
          setTimeout(() => setSaved(false), 2000);
        },
      }
    );
  };

  return (
    <SettingsCard
      title="Logging"
      description="Configure logging verbosity."
      onSave={handleSave}
      saving={updateConfig.isPending}
      saved={saved}
      hasChanges={hasChanges}
      disabled={isReadOnly || !config?.data?.daemon}
      error={updateConfig.error?.message}
    >
      <FormControl sx={{ minWidth: 200 }}>
        <InputLabel>Log Level</InputLabel>
        <Select
          value={logLevel}
          label="Log Level"
          onChange={(e) => setLogLevel(e.target.value as DaemonConfig['logLevel'])}
        >
          <MenuItem value="debug">Debug</MenuItem>
          <MenuItem value="info">Info</MenuItem>
          <MenuItem value="warn">Warning</MenuItem>
          <MenuItem value="error">Error</MenuItem>
        </Select>
      </FormControl>
    </SettingsCard>
  );
}
