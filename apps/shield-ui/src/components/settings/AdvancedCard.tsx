import { useState, useEffect, useRef } from 'react';
import { FormControlLabel, Switch, Typography } from '@mui/material';
import { useConfig, useUpdateConfig } from '../../api/hooks';
import { useGuardedAction } from '../../hooks/useGuardedAction';
import { SettingsCard } from '../shared/SettingsCard';

export function AdvancedCard() {
  const { data: config } = useConfig();
  const updateConfig = useUpdateConfig();
  const guard = useGuardedAction();

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
      onSave={() => guard(handleSave, { description: 'Unlock to save advanced settings.', actionLabel: 'Save' })}
      saving={updateConfig.isPending}
      saved={saved}
      hasChanges={hasChanges}
      disabled={!config?.data?.daemon}
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
