import { styled } from '@mui/material/styles';
import { coreHealthyPulse } from '../../../../styles/canvas-animations';

export const PolicyGraphWrapper = styled('div', {
  shouldForwardProp: (prop) => prop !== '$active',
})<{ $active: boolean }>(({ theme, $active }) => ({
  padding: '14px 24px',
  borderRadius: 12,
  border: `2px solid ${$active ? '#6BAEF2' : theme.palette.grey[500]}`,
  background: $active
    ? theme.palette.mode === 'dark' ? 'rgba(107, 174, 242, 0.06)' : theme.palette.background.paper
    : theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.02)' : theme.palette.background.paper,
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  fontFamily: "'Manrope', sans-serif",
  cursor: 'default',
  minWidth: 500,
  minHeight: 60,
  opacity: $active ? 1 : 0.5,
  ...($active && {
    animation: `${coreHealthyPulse} 4s ease-in-out infinite`,
  }),
}));

export const PolicyGraphLabel = styled('div')(({ theme }) => ({
  fontWeight: 700,
  fontSize: 14,
  color: theme.palette.text.primary,
  lineHeight: 1.3,
}));

export const PolicyGraphSub = styled('div')(({ theme }) => ({
  fontSize: 11,
  color: theme.palette.text.secondary,
  fontFamily: "'IBM Plex Mono', monospace",
  marginTop: 2,
}));
