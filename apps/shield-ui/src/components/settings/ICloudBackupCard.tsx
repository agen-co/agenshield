import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Box,
  FormControlLabel,
  Switch,
  Typography,
  Chip,
  Alert,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
} from '@mui/material';
import { Cloud, RefreshCw, Download } from 'lucide-react';
import { useSnapshot } from 'valtio';
import type { ICloudBackupConfig } from '@agenshield/ipc';
import { useConfig, useUpdateConfig } from '../../api/hooks';
import { useGuardedAction } from '../../hooks/useGuardedAction';
import { SettingsCard } from '../shared/SettingsCard';
import { systemStore } from '../../state/system-store';
import PrimaryButton from '../../elements/buttons/PrimaryButton';
import SecondaryButton from '../../elements/buttons/SecondaryButton';
import { authFetch } from '../../api/client';

const DEFAULT_CONFIG: ICloudBackupConfig = {
  enabled: false,
  intervalHours: 24,
};

const INTERVAL_OPTIONS = [
  { value: 6, label: 'Every 6 hours' },
  { value: 12, label: 'Every 12 hours' },
  { value: 24, label: 'Every 24 hours' },
  { value: 48, label: 'Every 48 hours' },
  { value: 168, label: 'Weekly' },
];

export function ICloudBackupCard() {
  const { data: config } = useConfig();
  const updateConfig = useUpdateConfig();
  const guard = useGuardedAction();
  const { systemInfo } = useSnapshot(systemStore);

  const [backupConfig, setBackupConfig] = useState<ICloudBackupConfig>(DEFAULT_CONFIG);
  const [saved, setSaved] = useState(false);
  const [backingUp, setBackingUp] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [actionResult, setActionResult] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const syncedVal = useRef<ICloudBackupConfig>(DEFAULT_CONFIG);

  const serverVal = config?.data?.icloudBackup;

  useEffect(() => {
    if (serverVal) {
      setBackupConfig(serverVal);
      syncedVal.current = serverVal;
    }
  }, [serverVal]);

  // Only show on macOS
  if (systemInfo?.platform !== 'darwin') return null;

  const hasChanges =
    backupConfig.enabled !== syncedVal.current.enabled ||
    backupConfig.intervalHours !== syncedVal.current.intervalHours;

  const handleSave = () => {
    updateConfig.mutate(
      { icloudBackup: backupConfig },
      {
        onSuccess: () => {
          syncedVal.current = { ...backupConfig };
          setSaved(true);
          setTimeout(() => setSaved(false), 2000);
        },
      }
    );
  };

  const handleBackupNow = useCallback(async () => {
    setBackingUp(true);
    setActionResult(null);
    try {
      const res = await authFetch('/api/icloud/backup', { method: 'POST' });
      const json = await res.json();
      if (json.success) {
        const count = json.data?.filesBackedUp ?? 0;
        setActionResult({ type: 'success', message: `Backup complete. ${count} file${count !== 1 ? 's' : ''} backed up.` });
      } else {
        setActionResult({ type: 'error', message: json.error?.message ?? 'Backup failed' });
      }
    } catch (err) {
      setActionResult({ type: 'error', message: (err as Error).message });
    } finally {
      setBackingUp(false);
    }
  }, []);

  const handleRestore = useCallback(async () => {
    setRestoring(true);
    setActionResult(null);
    try {
      const res = await authFetch('/api/icloud/restore', { method: 'POST' });
      const json = await res.json();
      if (json.success) {
        const count = json.data?.filesRestored ?? 0;
        setActionResult({
          type: 'success',
          message: `Restore complete. ${count} file${count !== 1 ? 's' : ''} restored. A daemon restart is recommended.`,
        });
      } else {
        setActionResult({ type: 'error', message: json.error?.message ?? 'Restore failed' });
      }
    } catch (err) {
      setActionResult({ type: 'error', message: (err as Error).message });
    } finally {
      setRestoring(false);
    }
  }, []);

  const lastBackup = backupConfig.lastBackupAt
    ? new Date(backupConfig.lastBackupAt).toLocaleString()
    : null;

  return (
    <SettingsCard
      title="iCloud Backup"
      description="Back up AgenShield data to iCloud Drive for seamless restore on new devices."
      footerInfo="Requires macOS with iCloud Drive enabled."
      onSave={() =>
        guard(handleSave, {
          description: 'Unlock to save iCloud backup settings.',
          actionLabel: 'Save',
        })
      }
      saving={updateConfig.isPending}
      saved={saved}
      hasChanges={hasChanges}
      disabled={!config?.data}
      error={updateConfig.error?.message}
    >
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <FormControlLabel
            control={
              <Switch
                checked={backupConfig.enabled}
                onChange={(e) =>
                  setBackupConfig((prev) => ({ ...prev, enabled: e.target.checked }))
                }
              />
            }
            label="Enable Automatic Backup"
            sx={{ ml: 0, gap: 1.5 }}
          />
          <Chip
            icon={<Cloud size={14} />}
            label="macOS"
            size="small"
            variant="outlined"
          />
        </Box>

        {backupConfig.enabled && (
          <>
            <FormControl sx={{ minWidth: 200, mt: 1 }}>
              <InputLabel>Backup Interval</InputLabel>
              <Select
                value={backupConfig.intervalHours}
                label="Backup Interval"
                onChange={(e) =>
                  setBackupConfig((prev) => ({
                    ...prev,
                    intervalHours: e.target.value as number,
                  }))
                }
              >
                {INTERVAL_OPTIONS.map((opt) => (
                  <MenuItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            {lastBackup && (
              <Typography variant="caption" color="text.secondary">
                Last backup: {lastBackup}
              </Typography>
            )}
          </>
        )}

        <Box sx={{ display: 'flex', gap: 1.5, mt: 1 }}>
          <PrimaryButton
            size="small"
            startIcon={<RefreshCw size={14} />}
            onClick={() =>
              guard(handleBackupNow, {
                description: 'Unlock to trigger iCloud backup.',
                actionLabel: 'Backup',
              })
            }
            loading={backingUp}
            disabled={backingUp || restoring}
          >
            Backup Now
          </PrimaryButton>
          <SecondaryButton
            size="small"
            startIcon={<Download size={14} />}
            onClick={() =>
              guard(handleRestore, {
                description: 'Unlock to restore from iCloud backup. This will overwrite current data.',
                actionLabel: 'Restore',
              })
            }
            loading={restoring}
            disabled={backingUp || restoring}
          >
            Restore from iCloud
          </SecondaryButton>
        </Box>

        {actionResult && (
          <Alert
            severity={actionResult.type}
            sx={{ mt: 1 }}
            onClose={() => setActionResult(null)}
          >
            {actionResult.message}
          </Alert>
        )}
      </Box>
    </SettingsCard>
  );
}
