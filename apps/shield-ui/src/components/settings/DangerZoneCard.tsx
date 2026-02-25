import { useState } from 'react';
import { Typography } from '@mui/material';
import { useFactoryReset } from '../../api/hooks';
import { useAuth } from '../../context/AuthContext';
import { SettingsCard } from '../shared/SettingsCard';
import { ConfirmDialog } from '../shared/ConfirmDialog';

export function DangerZoneCard() {
  const { refreshStatus } = useAuth();
  const factoryReset = useFactoryReset();
  const [confirmOpen, setConfirmOpen] = useState(false);

  const handleReset = () => {
    factoryReset.mutate(undefined, {
      onSuccess: () => {
        setConfirmOpen(false);
        sessionStorage.removeItem('agenshield_jwt_token');
        sessionStorage.removeItem('agenshield_jwt_expires');
        refreshStatus();
      },
    });
  };

  return (
    <>
      <SettingsCard
        title="Danger Zone"
        description="Irreversible actions that reset your AgenShield installation."
        danger
        saveLabel="Factory Reset"
        hasChanges
        onSave={() => setConfirmOpen(true)}
        saving={factoryReset.isPending}
        error={factoryReset.error?.message}
        footerInfo="This action cannot be undone."
      >
        <Typography variant="body2" color="text.secondary">
          Factory reset will permanently delete all policies, secrets,
          and authentication settings. AgenShield will return to its initial
          state as if freshly installed.
        </Typography>
      </SettingsCard>

      <ConfirmDialog
        open={confirmOpen}
        title="Factory Reset"
        message="This will permanently delete all policies, secrets, and authentication settings. AgenShield will return to its initial state. This action cannot be undone."
        confirmLabel="Reset Everything"
        variant="danger"
        onConfirm={handleReset}
        onCancel={() => setConfirmOpen(false)}
      />
    </>
  );
}
