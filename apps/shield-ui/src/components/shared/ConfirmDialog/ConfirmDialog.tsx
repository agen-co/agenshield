import {
  Dialog,
  DialogTitle,
  DialogContent,
  Box,
  Typography,
} from '@mui/material';
import PrimaryButton from '../../../elements/buttons/PrimaryButton';
import SecondaryButton from '../../../elements/buttons/SecondaryButton';
import DangerButton from '../../../elements/buttons/DangerButton';
import type { ConfirmDialogProps } from './ConfirmDialog.types';

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant = 'default',
  position = 'center',
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const ConfirmBtn = variant === 'danger' ? DangerButton : PrimaryButton;

  return (
    <Dialog
      open={open}
      onClose={onCancel}
      maxWidth="xs"
      fullWidth
      sx={
        position === 'top'
          ? { '& .MuiDialog-container': { alignItems: 'flex-start', pt: '3rem' } }
          : undefined
      }
    >
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary">
          {message}
        </Typography>
      </DialogContent>

      {/* Footer — edge-to-edge, matching SettingsCard / FormCard pattern */}
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
        <SecondaryButton size="small" onClick={onCancel}>
          {cancelLabel}
        </SecondaryButton>
        <ConfirmBtn size="small" onClick={onConfirm}>
          {confirmLabel}
        </ConfirmBtn>
      </Box>
    </Dialog>
  );
}
