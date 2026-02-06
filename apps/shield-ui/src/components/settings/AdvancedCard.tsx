import { useState, useEffect, useRef } from 'react';
import { FormControlLabel, Switch, Typography } from '@mui/material';
import { useConfig, useUpdateConfig } from '../../api/hooks';
import { useAuth } from '../../context/AuthContext';
import { SettingsCard } from '../shared/SettingsCard';

export function AdvancedCard() {
  const { data: config } = useConfig();
  const updateConfig = useUpdateConfig();
  const { isReadOnly } = useAuth();

  const [enableHostsEntry, setEnableHostsEntry] = useState(false);
  const [saved, setSaved] = useState(false);

  const syncedVal = useRef(false);

  const serverVal = config?.data?.daemon?.enableHostsEntry;

  useEffect(() => {
    if (serverVal != null) {
      setEnableHostsEntry(serverVal);
      syncedVal.current = serverVal;
    }
  }, [serverVal]);

  const hasChanges = enableHostsEntry !== syncedVal.current;

  const handleSave = () => {
    const daemon = config?.data?.daemon;
    if (!daemon) return;
    updateConfig.mutate(
      { daemon: { ...daemon, enableHostsEntry } },
      {
        onSuccess: () => {
          syncedVal.current = enableHostsEntry;
          setSaved(true);
          setTimeout(() => setSaved(false), 2000);
        },
      }
    );
  };

  return (
    <SettingsCard
      title="Advanced"
      description="Advanced configuration options."
      footerInfo="Requires administrator privileges."
      onSave={handleSave}
      saving={updateConfig.isPending}
      saved={saved}
      hasChanges={hasChanges}
      disabled={isReadOnly || !config?.data?.daemon}
      error={updateConfig.error?.message}
    >
      <FormControlLabel
        control={
          <Switch
            checked={enableHostsEntry}
            onChange={(e) => setEnableHostsEntry(e.target.checked)}
          />
        }
        label="Add agen.shield to /etc/hosts"
        sx={{ ml: 0, gap: 1.5 }}
      />
      <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
        Allows accessing the dashboard at http://agen.shield:5200
      </Typography>
    </SettingsCard>
  );
}
