import { Typography, CircularProgress, Box } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { Zap } from 'lucide-react';
import { StatusBadge } from '../../shared/StatusBadge';
import { Root, SkillIcon, Info } from './SkillCard.styles';
import type { SkillCardProps } from './SkillCard.types';

const statusConfig = {
  active: { label: 'Active', variant: 'success' as const },
  workspace: { label: 'Workspace', variant: 'info' as const },
  quarantined: { label: 'Quarantined', variant: 'warning' as const },
  disabled: { label: 'Disabled', variant: 'default' as const },
};

const vulnDotColors: Record<string, string> = {
  safe: '#6CB685',
  low: '#6BAEF2',
  medium: '#EEA45F',
  high: '#E1583E',
  critical: '#E1583E',
};

export function SkillCard({ skill, selected = false, onClick }: SkillCardProps) {
  const theme = useTheme();
  const config = statusConfig[skill.status];

  // Analysis status indicator
  const analysis = (skill as { analysis?: { status: string; vulnerability?: { level: string } } }).analysis;
  const isAnalyzing = analysis?.status === 'pending' || analysis?.status === 'analyzing';
  const vulnLevel = analysis?.status === 'complete' ? analysis.vulnerability?.level : undefined;

  return (
    <Root $selected={selected} onClick={onClick}>
      <SkillIcon $color={theme.palette.primary.main}>
        <Zap size={16} />
      </SkillIcon>
      <Info>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
          <Typography variant="body2" fontWeight={500} noWrap>
            {skill.name}
          </Typography>
          {isAnalyzing && <CircularProgress size={10} />}
          {vulnLevel && (
            <Box
              sx={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                bgcolor: vulnDotColors[vulnLevel] ?? theme.palette.grey[400],
                flexShrink: 0,
              }}
              title={`Vulnerability: ${vulnLevel}`}
            />
          )}
        </Box>
        {skill.description && (
          <Typography variant="caption" color="text.secondary" noWrap>
            {skill.description}
          </Typography>
        )}
      </Info>
      <StatusBadge label={config.label} variant={config.variant} size="small" />
    </Root>
  );
}
