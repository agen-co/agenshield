import { styled } from '@mui/material/styles';
import type { AlertSeverity } from '@agenshield/ipc';

const severityColorMap: Record<AlertSeverity, string> = {
  critical: '#E1583E',
  warning: '#EEA45F',
  info: '#6BAEF2',
};

export const SeverityBadge = styled('span')<{ $severity: AlertSeverity }>(
  ({ $severity }) => {
    const color = severityColorMap[$severity];
    return {
      display: 'inline-flex',
      alignItems: 'center',
      fontSize: 11,
      fontWeight: 600,
      lineHeight: 1,
      padding: '3px 8px',
      borderRadius: 4,
      color,
      backgroundColor: `${color}26`, // 15% opacity
      textTransform: 'capitalize',
    };
  },
);

export const DetailSection = styled('div')({
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  '& .detail-label': {
    fontSize: 10,
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
  },
  '& .detail-value': {
    fontSize: 12,
  },
});

export const DetailsCodeBlock = styled('div')(({ theme }) => ({
  position: 'relative',
  marginTop: 4,
  '& pre': {
    margin: 0,
    padding: 12,
    fontSize: 11,
    fontFamily: "'IBM Plex Mono', monospace",
    lineHeight: 1.5,
    borderRadius: 6,
    border: `1px solid ${theme.palette.divider}`,
    backgroundColor:
      theme.palette.mode === 'dark'
        ? 'rgba(255,255,255,0.04)'
        : 'rgba(0,0,0,0.03)',
    overflowX: 'auto',
    maxHeight: 200,
    overflowY: 'auto',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
  },
  '& .copy-btn': {
    position: 'absolute',
    top: 4,
    right: 4,
  },
}));
