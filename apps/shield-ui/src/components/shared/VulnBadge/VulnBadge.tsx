import { Box, Typography } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { ShieldCheck, ShieldAlert, ShieldX, Shield } from 'lucide-react';

export type VulnLevel = 'safe' | 'low' | 'medium' | 'high' | 'critical';

interface VulnBadgeProps {
  level: string;
  /** compact = card row, normal = detail page */
  size?: 'compact' | 'normal';
}

interface LevelConfig {
  label: string;
  color: string;
  bg: string;
  icon: typeof Shield;
}

const levelConfigs: Record<VulnLevel, LevelConfig> = {
  safe: {
    label: 'Safe',
    color: '#2e7d46',
    bg: 'rgba(108, 182, 133, 0.14)',
    icon: ShieldCheck,
  },
  low: {
    label: 'Low',
    color: '#1769aa',
    bg: 'rgba(107, 174, 242, 0.14)',
    icon: Shield,
  },
  medium: {
    label: 'Medium',
    color: '#b5791f',
    bg: 'rgba(238, 164, 95, 0.14)',
    icon: ShieldAlert,
  },
  high: {
    label: 'High',
    color: '#c62828',
    bg: 'rgba(225, 88, 62, 0.14)',
    icon: ShieldX,
  },
  critical: {
    label: 'Critical',
    color: '#b71c1c',
    bg: 'rgba(225, 88, 62, 0.22)',
    icon: ShieldX,
  },
};

const darkLevelConfigs: Record<VulnLevel, Pick<LevelConfig, 'color' | 'bg'>> = {
  safe: { color: '#81c995', bg: 'rgba(108, 182, 133, 0.18)' },
  low: { color: '#90caf9', bg: 'rgba(107, 174, 242, 0.18)' },
  medium: { color: '#ffcc80', bg: 'rgba(238, 164, 95, 0.18)' },
  high: { color: '#ef9a9a', bg: 'rgba(225, 88, 62, 0.18)' },
  critical: { color: '#ef5350', bg: 'rgba(225, 88, 62, 0.28)' },
};

export function VulnBadge({ level, size = 'compact' }: VulnBadgeProps) {
  const theme = useTheme();
  const config = levelConfigs[level as VulnLevel];
  if (!config) return null;

  const isDark = theme.palette.mode === 'dark';
  const darkOverride = isDark ? darkLevelConfigs[level as VulnLevel] : null;
  const color = darkOverride?.color ?? config.color;
  const bg = darkOverride?.bg ?? config.bg;
  const Icon = config.icon;

  const isCompact = size === 'compact';
  const iconSize = isCompact ? 12 : 15;
  const py = isCompact ? 0.25 : 0.5;
  const px = isCompact ? 0.75 : 1.25;
  const fontSize = isCompact ? '0.625rem' : '0.75rem';
  const borderRadius = isCompact ? 1 : 1.5;

  return (
    <Box
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 0.5,
        py,
        px,
        borderRadius,
        bgcolor: bg,
        border: `1px solid ${color}30`,
        flexShrink: 0,
      }}
      title={`Vulnerability: ${config.label}`}
    >
      <Icon size={iconSize} color={color} />
      <Typography
        component="span"
        sx={{
          fontSize,
          fontWeight: 700,
          color,
          lineHeight: 1,
          letterSpacing: '0.02em',
          textTransform: 'uppercase',
        }}
      >
        {config.label}
      </Typography>
    </Box>
  );
}
