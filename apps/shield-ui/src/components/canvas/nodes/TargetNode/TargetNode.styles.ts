import { styled } from '@mui/material/styles';
import { eventRipple, eventRippleError, eventRippleWarning } from '../../../../styles/canvas-animations';

export const TargetWrapper = styled('div', {
  shouldForwardProp: (prop) => !['$shielded', '$pulseSeverity'].includes(prop as string),
})<{ $shielded: boolean; $pulseSeverity?: string }>(({ theme, $shielded, $pulseSeverity }) => ({
  padding: '14px 18px',
  borderRadius: 12,
  border: `2px solid ${$shielded ? '#6CB685' : '#E1583E'}`,
  background: theme.palette.mode === 'dark'
    ? $shielded ? 'rgba(108, 182, 133, 0.06)' : 'rgba(225, 88, 62, 0.06)'
    : theme.palette.background.paper,
  display: 'flex',
  alignItems: 'flex-start',
  gap: 12,
  fontFamily: "'Manrope', sans-serif",
  minWidth: 160,
  cursor: 'default',
  ...($pulseSeverity === 'success' && {
    animation: `${eventRipple} 1.5s ease-out`,
  }),
  ...($pulseSeverity === 'error' && {
    animation: `${eventRippleError} 1.5s ease-out`,
  }),
  ...($pulseSeverity === 'warning' && {
    animation: `${eventRippleWarning} 1.5s ease-out`,
  }),
}));

export const TargetLabel = styled('div')(({ theme }) => ({
  fontWeight: 600,
  fontSize: 13,
  color: theme.palette.text.primary,
  lineHeight: 1.3,
}));

export const TargetSub = styled('div')(({ theme }) => ({
  fontSize: 11,
  color: theme.palette.text.secondary,
  fontFamily: "'IBM Plex Mono', monospace",
  marginTop: 2,
}));

export const TargetUsers = styled('div')(({ theme }) => ({
  fontSize: 10,
  color: theme.palette.text.secondary,
  marginTop: 4,
  display: 'flex',
  gap: 4,
  flexWrap: 'wrap' as const,
}));

export const UserChip = styled('span')(({ theme }) => ({
  padding: '1px 6px',
  borderRadius: 4,
  background: theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.06)' : theme.palette.grey[100],
  fontSize: 10,
  fontFamily: "'IBM Plex Mono', monospace",
}));

export const ActionRow = styled('div')({
  display: 'flex',
  gap: 4,
  marginTop: 6,
});

export const ActionBtn = styled('button')(({ theme }) => ({
  border: 'none',
  background: 'transparent',
  cursor: 'pointer',
  padding: 3,
  borderRadius: 4,
  display: 'flex',
  alignItems: 'center',
  color: theme.palette.text.secondary,
  '&:hover': {
    background: theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.1)' : theme.palette.grey[100],
    color: theme.palette.text.primary,
  },
}));
