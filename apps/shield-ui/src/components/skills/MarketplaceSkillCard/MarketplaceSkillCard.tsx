import { Typography, Chip, Box } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { Globe, Download } from 'lucide-react';
import { useCachedAnalysis } from '../../../api/hooks';
import { Root, SkillIcon, Info } from './MarketplaceSkillCard.styles';
import type { MarketplaceSkillCardProps } from './MarketplaceSkillCard.types';

const vulnDotColors: Record<string, string> = {
  safe: '#6CB685',
  low: '#6BAEF2',
  medium: '#EEA45F',
  high: '#E1583E',
  critical: '#E1583E',
};

export function MarketplaceSkillCard({ skill, onClick }: MarketplaceSkillCardProps) {
  const theme = useTheme();
  const { data: cachedData } = useCachedAnalysis(skill.name, skill.author);
  const vulnLevel = cachedData?.data?.analysis?.vulnerability?.level;

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
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, color: 'text.secondary', mr: 1 }}>
        <Download size={12} />
        <Typography variant="caption">{skill.installs.toLocaleString()}</Typography>
      </Box>
      <Chip label={skill.author} size="small" variant="outlined" />
    </Root>
  );
}
