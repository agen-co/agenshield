import { useState } from 'react';
import { Typography } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { useUnshieldTarget } from '../../api/targets';
import { SettingsCard } from '../shared/SettingsCard';
import { ConfirmDialog } from '../shared/ConfirmDialog';

interface UnshieldCardProps {
  targetId: string;
}

export function UnshieldCard({ targetId }: UnshieldCardProps) {
  const navigate = useNavigate();
  const unshield = useUnshieldTarget();
  const [confirmOpen, setConfirmOpen] = useState(false);

  const handleUnshield = () => {
    unshield.mutate(targetId, {
      onSuccess: () => {
        setConfirmOpen(false);
        navigate('/');
      },
    });
  };

  return (
    <>
      <SettingsCard
        title="Danger Zone"
        description="Remove protection from this target."
        danger
        saveLabel="Unshield"
        hasChanges
        onSave={() => setConfirmOpen(true)}
        saving={unshield.isPending}
        error={unshield.error?.message}
        footerInfo="This action cannot be undone."
      >
        <Typography variant="body2" color="text.secondary">
          Remove protection from this target. The agent will no longer be
          monitored by AgenShield. All target-specific policies and secrets
          will be deleted.
        </Typography>
      </SettingsCard>

      <ConfirmDialog
        open={confirmOpen}
        title="Unshield Target"
        message="This will remove AgenShield protection from this target. All target-specific policies and secrets will be deleted. This action cannot be undone."
        confirmLabel="Unshield"
        variant="danger"
        onConfirm={handleUnshield}
        onCancel={() => setConfirmOpen(false)}
      />
    </>
  );
}
