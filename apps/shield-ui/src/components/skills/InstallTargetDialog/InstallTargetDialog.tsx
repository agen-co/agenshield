import { useState, useMemo } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  Box,
  Typography,
  FormControlLabel,
  Checkbox,
  Chip,
} from '@mui/material';
import { Globe } from 'lucide-react';
import PrimaryButton from '../../../elements/buttons/PrimaryButton';
import SecondaryButton from '../../../elements/buttons/SecondaryButton';
import { CircularLoader } from '../../../elements/loaders/CircularLoader';
import { useTargets } from '../../../api/targets';
import { getTargetIcon } from '../../../utils/targetBranding';
import type { InstallTargetDialogProps } from './InstallTargetDialog.types';

export function InstallTargetDialog({
  open,
  skillName,
  skillSlug,
  existingInstallations,
  onInstall,
  onCancel,
}: InstallTargetDialogProps) {
  const { data: targetsData } = useTargets();
  const targets = targetsData?.data ?? [];

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [globalSelected, setGlobalSelected] = useState(false);
  const [installing, setInstalling] = useState(false);

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

  const handleToggleGlobal = () => {
    if (isGloballyInstalled) return;
    setGlobalSelected(prev => !prev);
    if (!globalSelected) setSelected(new Set());
  };

  const handleToggleTarget = (id: string) => {
    if (installedProfileIds.has(id)) return;
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setGlobalSelected(false);
  };

  const canInstall = globalSelected || selected.size > 0;

  const handleInstall = async () => {
    if (!canInstall) return;
    setInstalling(true);
    try {
      if (globalSelected) {
        await onInstall('global');
      } else {
        await onInstall(Array.from(selected));
      }
    } finally {
      setInstalling(false);
    }
  };

  // Reset state when dialog opens
  const handleExited = () => {
    setSelected(new Set());
    setGlobalSelected(false);
    setInstalling(false);
  };

  return (
    <Dialog
      open={open}
      onClose={installing ? undefined : onCancel}
      maxWidth="xs"
      fullWidth
      TransitionProps={{ onExited: handleExited }}
    >
      <DialogTitle>Install "{skillName}"</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Choose where to install this skill.
        </Typography>

        {/* Global option */}
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            px: 1.5,
            py: 1,
            borderRadius: 1,
            border: '1px solid',
            borderColor: globalSelected ? 'primary.main' : 'divider',
            mb: 1,
            opacity: isGloballyInstalled ? 0.5 : 1,
            cursor: isGloballyInstalled ? 'default' : 'pointer',
          }}
          onClick={handleToggleGlobal}
        >
          <Globe size={16} />
          <FormControlLabel
            control={
              <Checkbox
                checked={globalSelected || isGloballyInstalled}
                disabled={isGloballyInstalled}
                size="small"
                sx={{ p: 0.25 }}
              />
            }
            label={
              <Typography variant="body2" fontWeight={500}>
                All targets (global)
              </Typography>
            }
            sx={{ m: 0, flex: 1 }}
          />
          {isGloballyInstalled && (
            <Chip label="Installed" size="small" color="success" sx={{ height: 20, fontSize: '0.625rem' }} />
          )}
        </Box>

        {/* Per-target options */}
        {targets.map(target => {
          const TargetIcon = getTargetIcon(target.type);
          const isInstalled = installedProfileIds.has(target.id);
          const isChecked = selected.has(target.id) || isInstalled;

          return (
            <Box
              key={target.id}
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 1,
                px: 1.5,
                py: 1,
                borderRadius: 1,
                border: '1px solid',
                borderColor: selected.has(target.id) ? 'primary.main' : 'divider',
                mb: 1,
                opacity: isInstalled || globalSelected ? 0.5 : 1,
                cursor: isInstalled || globalSelected ? 'default' : 'pointer',
              }}
              onClick={() => !globalSelected && handleToggleTarget(target.id)}
            >
              <TargetIcon size={16} />
              <FormControlLabel
                control={
                  <Checkbox
                    checked={isChecked || globalSelected}
                    disabled={isInstalled || globalSelected}
                    size="small"
                    sx={{ p: 0.25 }}
                  />
                }
                label={
                  <Typography variant="body2" fontWeight={500}>
                    {target.name}
                  </Typography>
                }
                sx={{ m: 0, flex: 1 }}
              />
              {isInstalled && (
                <Chip label="Installed" size="small" color="success" sx={{ height: 20, fontSize: '0.625rem' }} />
              )}
            </Box>
          );
        })}

        {targets.length === 0 && (
          <Typography variant="body2" color="text.disabled" sx={{ textAlign: 'center', py: 2 }}>
            No targets detected. The skill will be installed globally.
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
          gap: 1.5,
          borderBottomLeftRadius: (theme.shape.borderRadius as number) * 3,
          borderBottomRightRadius: (theme.shape.borderRadius as number) * 3,
          bgcolor:
            theme.palette.mode === 'dark'
              ? theme.palette.background.default
              : theme.palette.grey[50],
        })}
      >
        <SecondaryButton size="small" onClick={onCancel} disabled={installing}>
          Cancel
        </SecondaryButton>
        <PrimaryButton size="small" onClick={handleInstall} disabled={!canInstall || installing}>
          {installing ? (
            <>
              <CircularLoader size={12} sx={{ mr: 0.5 }} />
              Installing
            </>
          ) : (
            'Install'
          )}
        </PrimaryButton>
      </Box>
    </Dialog>
  );
}
