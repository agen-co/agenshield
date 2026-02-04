import { styled } from '@mui/material/styles';
import type { StatusVariant } from './StatusBadge.types';
import { peaceGlow, alertPulse, breathe } from '../../../styles/animations';

export const Root = styled('span', {
  name: 'StatusBadge',
  slot: 'Root',
  shouldForwardProp: (prop) => !['$variant', '$size'].includes(prop as string),
})<{ $variant: StatusVariant; $size: 'small' | 'medium' }>(({ theme, $variant, $size }) => {
  const colorMap: Record<StatusVariant, string> = {
    success: theme.palette.success.main,
    warning: theme.palette.warning.main,
    error: theme.palette.error.main,
    info: theme.palette.info.main,
    default: theme.palette.text.secondary,
  };

  const color = colorMap[$variant];

  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    padding: $size === 'small' ? '2px 8px' : '4px 12px',
    borderRadius: 100,
    fontSize: $size === 'small' ? 12 : 13,
    fontWeight: 600,
    lineHeight: 1.5,
    color,
    backgroundColor: `${color}14`,
    border: `1px solid ${color}30`,
  };
});

export const Dot = styled('span', {
  name: 'StatusBadge',
  slot: 'Dot',
  shouldForwardProp: (prop) => prop !== '$variant',
})<{ $variant: StatusVariant }>(({ theme, $variant }) => {
  const colorMap: Record<StatusVariant, string> = {
    success: theme.palette.success.main,
    warning: theme.palette.warning.main,
    error: theme.palette.error.main,
    info: theme.palette.info.main,
    default: theme.palette.text.secondary,
  };

  const animationMap: Record<StatusVariant, string> = {
    success: `${peaceGlow} 3s ease-in-out infinite`,
    warning: `${breathe} 2s ease-in-out infinite`,
    error: `${alertPulse} 1.5s ease-in-out infinite`,
    info: `${breathe} 3s ease-in-out infinite`,
    default: 'none',
  };

  return {
    width: 6,
    height: 6,
    borderRadius: '50%',
    backgroundColor: colorMap[$variant],
    animation: animationMap[$variant],
  };
});
