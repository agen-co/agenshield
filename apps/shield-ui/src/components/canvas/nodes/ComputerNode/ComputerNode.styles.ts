import { styled } from '@mui/material/styles';
import { coreHealthyPulse, coreWarningPulse, coreErrorPulse } from '../../../../styles/canvas-animations';

type SecurityLevel = 'secure' | 'partial' | 'unprotected' | 'critical';

const borderColorMap: Record<SecurityLevel, string> = {
  secure: '#6CB685',
  partial: '#EEA45F',
  unprotected: '#E1583E',
  critical: '#E1583E',
};

const pulseMap = {
  secure: coreHealthyPulse,
  partial: coreWarningPulse,
  unprotected: coreErrorPulse,
  critical: coreErrorPulse,
};

export const ComputerWrapper = styled('div', {
  shouldForwardProp: (prop) => prop !== '$level',
})<{ $level: SecurityLevel }>(({ theme, $level }) => ({
  padding: '16px 28px',
  borderRadius: 14,
  border: `2px solid ${borderColorMap[$level]}`,
  background: theme.palette.mode === 'dark'
    ? 'rgba(255,255,255,0.03)'
    : theme.palette.background.paper,
  display: 'flex',
  alignItems: 'center',
  gap: 14,
  fontFamily: "'Manrope', sans-serif",
  cursor: 'default',
  minWidth: 200,
  animation: `${pulseMap[$level]} 4s ease-in-out infinite`,
}));

export const ComputerLabel = styled('div')(({ theme }) => ({
  fontWeight: 700,
  fontSize: 14,
  color: theme.palette.text.primary,
  lineHeight: 1.3,
}));

export const ComputerSub = styled('div')(({ theme }) => ({
  fontSize: 11,
  color: theme.palette.text.secondary,
  fontFamily: "'IBM Plex Mono', monospace",
  marginTop: 2,
}));

export const LevelBadge = styled('div', {
  shouldForwardProp: (prop) => prop !== '$level',
})<{ $level: SecurityLevel }>(({ $level }) => ({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  padding: '2px 8px',
  borderRadius: 10,
  fontSize: 10,
  fontWeight: 600,
  textTransform: 'uppercase' as const,
  letterSpacing: 0.5,
  background: `${borderColorMap[$level]}20`,
  color: borderColorMap[$level],
}));
