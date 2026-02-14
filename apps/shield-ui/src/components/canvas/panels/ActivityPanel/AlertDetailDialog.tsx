import { useState } from 'react';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Tooltip from '@mui/material/Tooltip';
import MuiIconButton from '@mui/material/IconButton';
import { X, Copy, Check, Bell } from 'lucide-react';
import type { Alert } from '@agenshield/ipc';
import PrimaryButton from '../../../../elements/buttons/PrimaryButton';
import SecondaryButton from '../../../../elements/buttons/SecondaryButton';
import { SeverityBadge, DetailSection, DetailsCodeBlock } from './AlertDetailDialog.styles';

interface AlertDetailDialogProps {
  alert: Alert | null;
  onClose: () => void;
  onAcknowledge: (id: number) => void;
  onNext: () => void;
  hasNext: boolean;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('en-US', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

function buildCopyText(alert: Alert): string {
  const severity = alert.severity.toUpperCase();
  const lines = [
    `[${severity}] ${alert.title}`,
    alert.description,
    '',
    `Event: ${alert.eventType}`,
    `Target: ${alert.navigationTarget}`,
    `Created: ${formatDate(alert.createdAt)}`,
  ];
  if (alert.details) {
    lines.push('', 'Details:', JSON.stringify(alert.details, null, 2));
  }
  return lines.join('\n');
}

export function AlertDetailDialog({
  alert,
  onClose,
  onAcknowledge,
  onNext,
  hasNext,
}: AlertDetailDialogProps) {
  const [copied, setCopied] = useState(false);
  const [detailsCopied, setDetailsCopied] = useState(false);

  if (!alert) return null;

  const handleCopy = async () => {
    await navigator.clipboard.writeText(buildCopyText(alert));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleCopyDetails = async () => {
    await navigator.clipboard.writeText(JSON.stringify(alert.details, null, 2));
    setDetailsCopied(true);
    setTimeout(() => setDetailsCopied(false), 2000);
  };

  const handleAcknowledge = () => {
    onAcknowledge(alert.id);
    if (hasNext) {
      onNext();
    } else {
      onClose();
    }
  };

  const detailsJson = alert.details
    ? JSON.stringify(alert.details, null, 2)
    : null;

  const metaItems = [
    { label: 'Event Type', value: alert.eventType },
    { label: 'Target', value: alert.navigationTarget },
    { label: 'Created', value: formatDate(alert.createdAt) },
    { label: 'Profile', value: alert.profileId ?? '\u2014' },
  ];

  return (
    <Dialog open maxWidth="sm" fullWidth onClose={onClose}>
      <DialogTitle
        sx={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: 1,
          pr: 6,
        }}
      >
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="subtitle1" fontWeight={600} sx={{ mb: 0.5 }}>
            {alert.title}
          </Typography>
          <SeverityBadge $severity={alert.severity}>{alert.severity}</SeverityBadge>
        </Box>
        <MuiIconButton
          size="small"
          onClick={onClose}
          sx={{ position: 'absolute', top: 8, right: 8 }}
        >
          <X size={16} />
        </MuiIconButton>
      </DialogTitle>

      <DialogContent dividers sx={{ py: 2 }}>
        {/* Description */}
        <Typography variant="body2" sx={{ mb: 2 }}>
          {alert.description}
        </Typography>

        {/* Metadata grid */}
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: 1.5,
            mb: 2,
          }}
        >
          {metaItems.map((item) => (
            <DetailSection key={item.label}>
              <span className="detail-label" style={{ opacity: 0.6 }}>
                {item.label}
              </span>
              <span className="detail-value">{item.value}</span>
            </DetailSection>
          ))}
        </Box>

        {/* Details / Trace */}
        {detailsJson && (
          <Box>
            <Typography
              variant="body2"
              fontWeight={600}
              sx={{ mb: 0.5, fontSize: 12 }}
            >
              Details / Trace
            </Typography>
            <DetailsCodeBlock>
              <pre>{detailsJson}</pre>
              <MuiIconButton
                size="small"
                className="copy-btn"
                onClick={handleCopyDetails}
                title="Copy details"
              >
                {detailsCopied ? <Check size={13} /> : <Copy size={13} />}
              </MuiIconButton>
            </DetailsCodeBlock>
          </Box>
        )}
      </DialogContent>

      {/* Footer */}
      <Box
        sx={(theme) => ({
          borderTop: `1px solid ${theme.palette.divider}`,
          px: 3,
          py: 1.5,
          display: 'flex',
          alignItems: 'center',
          gap: 1.5,
          borderBottomLeftRadius: (theme.shape.borderRadius as number) * 3,
          borderBottomRightRadius: (theme.shape.borderRadius as number) * 3,
          bgcolor:
            theme.palette.mode === 'dark'
              ? theme.palette.grey[800]
              : theme.palette.grey[200],
        })}
      >
        <SecondaryButton size="small" onClick={onClose}>
          Keep for Later
        </SecondaryButton>
        <Tooltip title="Coming soon" arrow>
          <span>
            <SecondaryButton
              size="small"
              disabled
              startIcon={<Bell size={13} />}
            >
              Send Notification
            </SecondaryButton>
          </span>
        </Tooltip>

        <Box sx={{ ml: 'auto', display: 'flex', gap: 1.5 }}>
          <SecondaryButton
            size="small"
            startIcon={copied ? <Check size={13} /> : <Copy size={13} />}
            onClick={handleCopy}
          >
            {copied ? 'Copied' : 'Copy'}
          </SecondaryButton>
          <PrimaryButton size="small" onClick={handleAcknowledge}>
            Acknowledge
          </PrimaryButton>
        </Box>
      </Box>
    </Dialog>
  );
}
