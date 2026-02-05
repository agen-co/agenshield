import { Typography, Chip, Box } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { Globe, Download } from 'lucide-react';
import { Root, SkillIcon, Info } from './MarketplaceSkillCard.styles';
import type { MarketplaceSkillCardProps } from './MarketplaceSkillCard.types';

export function MarketplaceSkillCard({ skill, onClick }: MarketplaceSkillCardProps) {
  const theme = useTheme();

  return (
    <Root onClick={onClick}>
      <SkillIcon $color={theme.palette.primary.main}>
        <Globe size={16} />
      </SkillIcon>
      <Info>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
          <Typography variant="body2" fontWeight={500} noWrap>
            {skill.name}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            v{skill.version}
          </Typography>
        </Box>
        {skill.description && (
          <Typography variant="caption" color="text.secondary" noWrap>
            {skill.description}
          </Typography>
        )}
      </Info>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, color: 'text.secondary', mr: 1 }}>
        <Download size={12} />
        <Typography variant="caption">{skill.installs.toLocaleString()}</Typography>
      </Box>
      <Chip label={skill.author} size="small" variant="outlined" />
    </Root>
  );
}
