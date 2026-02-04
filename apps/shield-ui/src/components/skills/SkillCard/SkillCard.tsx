import { Typography } from '@mui/material';
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

export function SkillCard({ skill, selected = false, onClick }: SkillCardProps) {
  const theme = useTheme();
  const config = statusConfig[skill.status];

  return (
    <Root $selected={selected} onClick={onClick}>
      <SkillIcon $color={theme.palette.primary.main}>
        <Zap size={16} />
      </SkillIcon>
      <Info>
        <Typography variant="body2" fontWeight={500} noWrap>
          {skill.name}
        </Typography>
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
