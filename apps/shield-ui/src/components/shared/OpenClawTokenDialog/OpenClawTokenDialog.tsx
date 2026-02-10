import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  Box,
  Typography,
  IconButton,
  Tooltip,
} from '@mui/material';
import { Copy, Check } from 'lucide-react';
import PrimaryButton from '../../../elements/buttons/PrimaryButton';
import SecondaryButton from '../../../elements/buttons/SecondaryButton';
import { notify } from '../../../stores/notifications';
import type { OpenClawTokenDialogProps } from './OpenClawTokenDialog.types';

export function OpenClawTokenDialog({
  open,
  url,
  token,
  onClose,
}: OpenClawTokenDialogProps) {
  const [copied, setCopied] = useState(false);

  // Auto-copy token to clipboard when dialog opens
  useEffect(() => {
    if (open && token) {
      navigator.clipboard.writeText(token).then(() => {
        setCopied(true);
        notify.success('Token copied to clipboard');
      }).catch(() => {
        // Clipboard API may not be available
      });
    }
    if (!open) {
      setCopied(false);
    }
  }, [open, token]);

  const handleCopy = () => {
    navigator.clipboard.writeText(token).then(() => {
      setCopied(true);
      notify.success('Token copied to clipboard');
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleOpen = () => {
    window.open(url, '_blank');
    onClose();
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>OpenClaw Gateway Token</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          The gateway token has been copied to your clipboard. After opening the
          dashboard, paste it into the Gateway Token field on the Overview page.
        </Typography>

        <Box
          sx={(theme) => ({
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            p: 1.5,
            borderRadius: 1,
            border: `1px solid ${theme.palette.divider}`,
            bgcolor:
              theme.palette.mode === 'dark'
                ? theme.palette.background.default
                : theme.palette.grey[50],
          })}
        >
          <Typography
            variant="body2"
            sx={{
              flex: 1,
              fontFamily: '"IBM Plex Mono", monospace',
              fontSize: '0.8125rem',
              wordBreak: 'break-all',
              userSelect: 'all',
            }}
          >
            {token}
          </Typography>
          <Tooltip title={copied ? 'Copied' : 'Copy token'}>
            <IconButton size="small" onClick={handleCopy}>
              {copied ? <Check size={16} /> : <Copy size={16} />}
            </IconButton>
          </Tooltip>
        </Box>
      </DialogContent>

      {/* Footer — edge-to-edge, matching ConfirmDialog pattern */}
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
        <SecondaryButton size="small" onClick={onClose}>
          Cancel
        </SecondaryButton>
        <PrimaryButton size="small" onClick={handleOpen}>
          Open
        </PrimaryButton>
      </Box>
    </Dialog>
  );
}
