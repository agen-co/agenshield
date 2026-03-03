import { useState, useCallback } from 'react';
import { Box, Typography, Tooltip } from '@mui/material';
import { Download, Send } from 'lucide-react';
import type { LogBundle } from '@agenshield/ipc';
import { useDownloadLogs } from '../../api/hooks';
import { SettingsCard } from '../shared/SettingsCard';
import PrimaryButton from '../../elements/buttons/PrimaryButton';
import SecondaryButton from '../../elements/buttons/SecondaryButton';

function triggerDownload(bundle: LogBundle) {
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const filename = `agenshield-logs-${ts}.json`;
  const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function DiagnosticsCard() {
  const downloadLogs = useDownloadLogs();
  const [downloaded, setDownloaded] = useState(false);

  const handleDownload = useCallback(() => {
    setDownloaded(false);
    downloadLogs.mutate(undefined, {
      onSuccess: (res) => {
        triggerDownload(res.data);
        setDownloaded(true);
        setTimeout(() => setDownloaded(false), 3000);
      },
    });
  }, [downloadLogs]);

  return (
    <SettingsCard
      title="Diagnostics & Support"
      description="Download system logs for troubleshooting. All sensitive data is automatically redacted."
      onSave={handleDownload}
      saveLabel={downloaded ? 'Downloaded' : 'Download Logs'}
      saving={downloadLogs.isPending}
      saved={downloaded}
      hasChanges
      error={downloadLogs.error?.message}
      footerInfo="Logs are sanitized — API keys, tokens, and personal paths are redacted before download."
    >
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <Typography variant="body2" color="text.secondary">
          Generate a diagnostic bundle containing sanitized shield operation logs
          and recent daemon logs. Share this file with AgenShield support for
          faster troubleshooting.
        </Typography>

        <Box sx={{ display: 'flex', gap: 1.5 }}>
          <PrimaryButton
            size="small"
            startIcon={<Download size={14} />}
            onClick={handleDownload}
            loading={downloadLogs.isPending}
          >
            Download Logs
          </PrimaryButton>
          <Tooltip title="Coming soon" arrow>
            <span>
              <SecondaryButton
                size="small"
                startIcon={<Send size={14} />}
                disabled
              >
                Send to Support
              </SecondaryButton>
            </span>
          </Tooltip>
        </Box>
      </Box>
    </SettingsCard>
  );
}
