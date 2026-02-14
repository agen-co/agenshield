import { styled } from '@mui/material/styles';

const statusColors: Record<string, string> = {
  ok: '#6CB685',
  warning: '#EEA45F',
  error: '#E1583E',
};

export const HudWrapper = styled('div')({
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 4,
  cursor: 'default',
  fontFamily: "'Manrope', sans-serif",
  minWidth: 56,
});

export const HudIconBox = styled('div')(({ theme }) => ({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 36,
  height: 36,
  borderRadius: 8,
  background: theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.04)' : theme.palette.grey[50],
  border: `1px solid ${theme.palette.divider}`,
  position: 'relative',
}));

export const StatusDot = styled('div', {
  shouldForwardProp: (prop) => prop !== '$status',
})<{ $status: string }>(() => ({
  position: 'absolute',
  top: -2,
  right: -2,
  width: 8,
  height: 8,
  borderRadius: '50%',
}));

export function getStatusColor(status: string): string {
  return statusColors[status] ?? '#808080';
}

export const HudLabel = styled('div')(({ theme }) => ({
  fontSize: 10,
  fontWeight: 600,
  color: theme.palette.text.secondary,
  textAlign: 'center',
  letterSpacing: 0.3,
}));

export const HudValue = styled('div')(({ theme }) => ({
  fontSize: 10,
  color: theme.palette.text.secondary,
  fontFamily: "'IBM Plex Mono', monospace",
  textAlign: 'center',
}));
