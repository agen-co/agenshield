import { styled } from '@mui/material/styles';
import { coreHealthyPulse } from '../../../../styles/canvas-animations';

export const FirewallWrapper = styled('div', {
  shouldForwardProp: (prop) => prop !== '$active',
})<{ $active: boolean }>(({ theme, $active }) => ({
  padding: '12px 18px',
  borderRadius: 10,
  border: `2px solid ${$active ? '#6CB685' : theme.palette.grey[500]}`,
  background: $active
    ? theme.palette.mode === 'dark' ? 'rgba(108, 182, 133, 0.06)' : theme.palette.background.paper
    : theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.02)' : theme.palette.background.paper,
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  fontFamily: "'Manrope', sans-serif",
  cursor: 'default',
  minWidth: 140,
  opacity: $active ? 1 : 0.5,
  ...($active && {
    animation: `${coreHealthyPulse} 4s ease-in-out infinite`,
  }),
}));

export const FirewallLabel = styled('div')(({ theme }) => ({
  fontWeight: 600,
  fontSize: 12,
  color: theme.palette.text.primary,
  lineHeight: 1.3,
}));

export const FirewallSub = styled('div')(({ theme }) => ({
  fontSize: 10,
  color: theme.palette.text.secondary,
  fontFamily: "'IBM Plex Mono', monospace",
  marginTop: 1,
}));
