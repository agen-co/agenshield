import { styled } from '@mui/material/styles';
import { coreHealthyPulse, coreWarningPulse, coreErrorPulse } from '../../../../styles/canvas-animations';
import type { CanvasStatus } from '../../Canvas.types';

const pulseMap = {
  ok: coreHealthyPulse,
  warning: coreWarningPulse,
  error: coreErrorPulse,
};

const borderColorMap = {
  ok: '#6CB685',
  warning: '#EEA45F',
  error: '#E1583E',
};

const bgColorMap = {
  ok: 'rgba(108, 182, 133, 0.08)',
  warning: 'rgba(238, 164, 95, 0.08)',
  error: 'rgba(225, 88, 62, 0.08)',
};

export const CoreWrapper = styled('div', {
  shouldForwardProp: (prop) => prop !== '$status',
})<{ $status: CanvasStatus }>(({ theme, $status }) => ({
  padding: '20px 28px',
  borderRadius: 16,
  border: `2px solid ${borderColorMap[$status]}`,
  background: theme.palette.mode === 'dark' ? bgColorMap[$status] : theme.palette.background.paper,
  display: 'flex',
  alignItems: 'center',
  gap: 14,
  fontFamily: "'Manrope', sans-serif",
  animation: `${pulseMap[$status]} 3s ease-in-out infinite`,
  minWidth: 180,
  cursor: 'default',
}));

export const CoreIcon = styled('div', {
  shouldForwardProp: (prop) => prop !== '$status',
})<{ $status: CanvasStatus }>(() => ({
  flexShrink: 0,
  display: 'flex',
  alignItems: 'center',
}));

export const CoreLabel = styled('div')(({ theme }) => ({
  fontWeight: 700,
  fontSize: 15,
  color: theme.palette.text.primary,
  lineHeight: 1.3,
}));

export const CoreSub = styled('div')(({ theme }) => ({
  fontSize: 11,
  color: theme.palette.text.secondary,
  fontFamily: "'IBM Plex Mono', monospace",
  marginTop: 2,
}));
