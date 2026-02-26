import { useState, useMemo, useCallback } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  Box,
  Typography,
  Chip,
  Button,
} from '@mui/material';
import { Globe } from 'lucide-react';
import PrimaryButton from '../../../elements/buttons/PrimaryButton';
import SecondaryButton from '../../../elements/buttons/SecondaryButton';
import { CircularLoader } from '../../../elements/loaders/CircularLoader';
import { useTargets } from '../../../api/targets';
import { getTargetIcon } from '../../../utils/targetBranding';
import type { InstallTargetDialogProps } from './InstallTargetDialog.types';

const GLOBAL_KEY = '__global__';

export function InstallTargetDialog({
  open,
  skillName,
  existingInstallations,
  onInstallToTarget,
  onUninstallFromTarget,
  onClose,
}: InstallTargetDialogProps) {
  const { data: targetsData } = useTargets();
  const targets = targetsData?.data ?? [];

  const [loading, setLoading] = useState<Map<string, boolean>>(new Map());

  const isGloballyInstalled = useMemo(
    () => existingInstallations?.some(i => !i.profileId && i.status === 'active') ?? false,
    [existingInstallations],
  );

  const installedProfileIds = useMemo(() => {
    const set = new Set<string>();
    for (const inst of existingInstallations ?? []) {
      if (inst.profileId) set.add(inst.profileId);
    }
    return set;
  }, [existingInstallations]);

  const setTargetLoading = useCallback((key: string, value: boolean) => {
    setLoading(prev => {
      const next = new Map(prev);
      if (value) next.set(key, true);
      else next.delete(key);
      return next;
    });
  }, []);

  const handleInstall = useCallback(async (targetId?: string) => {
    const key = targetId ?? GLOBAL_KEY;
    setTargetLoading(key, true);
    try {
      await onInstallToTarget(targetId);
    } finally {
      setTargetLoading(key, false);
    }
  }, [onInstallToTarget, setTargetLoading]);

  const handleUninstall = useCallback(async (targetId?: string) => {
    const key = targetId ?? GLOBAL_KEY;
    setTargetLoading(key, true);
    try {
      await onUninstallFromTarget(targetId);
    } finally {
      setTargetLoading(key, false);
    }
  }, [onUninstallFromTarget, setTargetLoading]);

  const anyLoading = loading.size > 0;

  const handleExited = () => {
    setLoading(new Map());
  };

  return (
    <Dialog
      open={open}
      onClose={anyLoading ? undefined : onClose}
      maxWidth="xs"
      fullWidth
      TransitionProps={{ onExited: handleExited }}
    >
      <DialogTitle>Manage "{skillName}"</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Install or uninstall this skill per target.
        </Typography>

        {/* Global row */}
        <TargetRow
          icon={<Globe size={16} />}
          label="Global (all targets)"
          installed={isGloballyInstalled}
          loading={loading.get(GLOBAL_KEY) ?? false}
          disabled={anyLoading}
          onInstall={() => handleInstall(undefined)}
          onUninstall={() => handleUninstall(undefined)}
        />

        {/* Per-target rows */}
        {targets.map(target => {
          const TargetIcon = getTargetIcon(target.type);
          const isInstalled = installedProfileIds.has(target.id);
          const isLoading = loading.get(target.id) ?? false;

          return (
            <TargetRow
              key={target.id}
              icon={<TargetIcon size={16} />}
              label={target.name}
              installed={isInstalled}
              loading={isLoading}
              disabled={anyLoading}
              onInstall={() => handleInstall(target.id)}
              onUninstall={() => handleUninstall(target.id)}
            />
          );
        })}

        {targets.length === 0 && (
          <Typography variant="body2" color="text.disabled" sx={{ textAlign: 'center', py: 2 }}>
            No targets detected. Use "Global" to install for all targets.
          </Typography>
        )}
      </DialogContent>

      <Box
        sx={(theme) => ({
          borderTop: `1px solid ${theme.palette.divider}`,
          px: 3,
          py: 1.5,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'flex-end',
          borderBottomLeftRadius: (theme.shape.borderRadius as number) * 3,
          borderBottomRightRadius: (theme.shape.borderRadius as number) * 3,
          bgcolor:
            theme.palette.mode === 'dark'
              ? theme.palette.background.default
              : theme.palette.grey[50],
        })}
      >
        <SecondaryButton size="small" onClick={onClose} disabled={anyLoading}>
          Done
        </SecondaryButton>
      </Box>
    </Dialog>
  );
}

function TargetRow({
  icon,
  label,
  installed,
  loading: isLoading,
  disabled,
  onInstall,
  onUninstall,
}: {
  icon: React.ReactNode;
  label: string;
  installed: boolean;
  loading: boolean;
  disabled: boolean;
  onInstall: () => void;
  onUninstall: () => void;
}) {
  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1,
        px: 1.5,
        py: 1,
        borderRadius: 1,
        border: '1px solid',
        borderColor: 'divider',
        mb: 1,
      }}
    >
      {icon}
      <Typography variant="body2" fontWeight={500} sx={{ flex: 1 }}>
        {label}
      </Typography>
      {installed ? (
        <>
          <Chip label="Installed" size="small" color="success" sx={{ height: 20, fontSize: '0.625rem' }} />
          <Button
            size="small"
            variant="outlined"
            color="error"
            onClick={onUninstall}
            disabled={disabled}
            sx={{ minWidth: 80, textTransform: 'unset' }}
          >
            {isLoading ? <CircularLoader size={12} /> : 'Uninstall'}
          </Button>
        </>
      ) : (
        <PrimaryButton
          size="small"
          onClick={onInstall}
          disabled={disabled}
          sx={{ minWidth: 80 }}
        >
          {isLoading ? <CircularLoader size={12} /> : 'Install'}
        </PrimaryButton>
      )}
    </Box>
  );
}
