import { useState, useEffect, useRef } from 'react';
import {
  Box,
  FormControlLabel,
  Switch,
  Checkbox,
  Typography,
  Chip,
  Alert,
} from '@mui/material';
import { KeyRound } from 'lucide-react';
import { useSnapshot } from 'valtio';
import type { KeychainIntegrationConfig } from '@agenshield/ipc';
import { useConfig, useUpdateConfig } from '../../api/hooks';
import { useGuardedAction } from '../../hooks/useGuardedAction';
import { SettingsCard } from '../shared/SettingsCard';
import { systemStore } from '../../state/system-store';
import SecondaryButton from '../../elements/buttons/SecondaryButton';
import { authFetch } from '../../api/client';

type Category = KeychainIntegrationConfig['categories'][number];

const CATEGORY_LABELS: Record<Category, { label: string; description: string }> = {
  'vault-key': { label: 'Vault Key', description: 'Store the encryption key in Keychain' },
  'oauth-tokens': { label: 'OAuth Tokens', description: 'Store authentication tokens in Keychain' },
  secrets: { label: 'Secrets', description: 'Store user secrets in Keychain' },
};

const DEFAULT_CONFIG: KeychainIntegrationConfig = {
  enabled: false,
  categories: [],
  syncToICloud: false,
};

export function KeychainCard() {
  const { data: config } = useConfig();
  const updateConfig = useUpdateConfig();
  const guard = useGuardedAction();
  const { systemInfo } = useSnapshot(systemStore);

  const [keychainConfig, setKeychainConfig] = useState<KeychainIntegrationConfig>(DEFAULT_CONFIG);
  const [saved, setSaved] = useState(false);
  const [migrating, setMigrating] = useState(false);
  const [migrateResult, setMigrateResult] = useState<string | null>(null);

  const syncedVal = useRef<KeychainIntegrationConfig>(DEFAULT_CONFIG);

  const serverVal = config?.data?.keychain;

  useEffect(() => {
    if (serverVal) {
      setKeychainConfig(serverVal);
      syncedVal.current = serverVal;
    }
  }, [serverVal]);

  // Only show on macOS
  if (systemInfo?.platform !== 'darwin') return null;

  const hasChanges =
    keychainConfig.enabled !== syncedVal.current.enabled ||
    keychainConfig.syncToICloud !== syncedVal.current.syncToICloud ||
    JSON.stringify([...keychainConfig.categories].sort()) !==
      JSON.stringify([...syncedVal.current.categories].sort());

  const handleCategoryToggle = (cat: Category) => {
    setKeychainConfig((prev) => {
      const has = prev.categories.includes(cat);
      return {
        ...prev,
        categories: has
          ? prev.categories.filter((c) => c !== cat)
          : [...prev.categories, cat],
      };
    });
  };

  const handleSave = () => {
    updateConfig.mutate(
      { keychain: keychainConfig },
      {
        onSuccess: () => {
          syncedVal.current = { ...keychainConfig };
          setSaved(true);
          setTimeout(() => setSaved(false), 2000);
        },
      }
    );
  };

  const handleMigrate = async () => {
    setMigrating(true);
    setMigrateResult(null);
    try {
      const res = await authFetch('/api/config/keychain/migrate', { method: 'POST' });
      const json = await res.json();
      if (json.success) {
        setMigrateResult('Migration complete. Vault key is now stored in Keychain.');
      } else {
        setMigrateResult(`Migration failed: ${json.error?.message ?? 'Unknown error'}`);
      }
    } catch (err) {
      setMigrateResult(`Migration failed: ${(err as Error).message}`);
    } finally {
      setMigrating(false);
    }
  };

  return (
    <SettingsCard
      title="Keychain"
      description="Store sensitive data in macOS Keychain for hardware-backed security."
      footerInfo="Requires macOS. Falls back to file-based storage when disabled."
      onSave={() =>
        guard(handleSave, {
          description: 'Unlock to save Keychain settings.',
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
                checked={keychainConfig.enabled}
                onChange={(e) =>
                  setKeychainConfig((prev) => ({ ...prev, enabled: e.target.checked }))
                }
              />
            }
            label="Enable Keychain Integration"
            sx={{ ml: 0, gap: 1.5 }}
          />
          <Chip
            icon={<KeyRound size={14} />}
            label="macOS"
            size="small"
            variant="outlined"
          />
        </Box>

        {keychainConfig.enabled && (
          <>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              Select which categories of data to store in Keychain:
            </Typography>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, pl: 1 }}>
              {(Object.keys(CATEGORY_LABELS) as Category[]).map((cat) => (
                <FormControlLabel
                  key={cat}
                  control={
                    <Checkbox
                      checked={keychainConfig.categories.includes(cat)}
                      onChange={() => handleCategoryToggle(cat)}
                      size="small"
                    />
                  }
                  label={
                    <Box>
                      <Typography variant="body2">{CATEGORY_LABELS[cat].label}</Typography>
                      <Typography variant="caption" color="text.secondary">
                        {CATEGORY_LABELS[cat].description}
                      </Typography>
                    </Box>
                  }
                  sx={{ ml: 0, gap: 1, alignItems: 'flex-start' }}
                />
              ))}
            </Box>

            <FormControlLabel
              control={
                <Switch
                  checked={keychainConfig.syncToICloud}
                  onChange={(e) =>
                    setKeychainConfig((prev) => ({
                      ...prev,
                      syncToICloud: e.target.checked,
                    }))
                  }
                />
              }
              label="Sync to iCloud Keychain"
              sx={{ ml: 0, gap: 1.5, mt: 1 }}
            />
            <Typography variant="caption" color="text.secondary" sx={{ pl: 6 }}>
              Share tokens and secrets across your Apple devices via iCloud Keychain.
            </Typography>

            <Box sx={{ mt: 2, display: 'flex', alignItems: 'center', gap: 2 }}>
              <SecondaryButton
                size="small"
                onClick={() =>
                  guard(handleMigrate, {
                    description: 'Unlock to migrate vault key to Keychain.',
                    actionLabel: 'Migrate',
                  })
                }
                loading={migrating}
                disabled={migrating}
              >
                Migrate Vault Key to Keychain
              </SecondaryButton>
            </Box>
            {migrateResult && (
              <Alert
                severity={migrateResult.includes('failed') ? 'error' : 'success'}
                sx={{ mt: 1 }}
                onClose={() => setMigrateResult(null)}
              >
                {migrateResult}
              </Alert>
            )}
          </>
        )}
      </Box>
    </SettingsCard>
  );
}
