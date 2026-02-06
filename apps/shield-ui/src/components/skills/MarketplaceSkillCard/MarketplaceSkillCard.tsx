import { Typography, Chip, Box, Button, CircularProgress } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { Globe, Download, Trash2 } from 'lucide-react';
import { useCachedAnalysis, useToggleSkill } from '../../../api/hooks';
import { Root, Header, SkillIcon, Info } from './MarketplaceSkillCard.styles';
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
  const toggleMutation = useToggleSkill();
  const vulnLevel = cachedData?.data?.analysis?.vulnerability?.level;

  const handleUninstall = (e: React.MouseEvent) => {
    e.stopPropagation();
    toggleMutation.mutate(skill.slug);
  };

  return (
    <Root onClick={onClick}>
      <Header>
        <SkillIcon $color={theme.palette.primary.main}>
          <Globe size={16} />
        </SkillIcon>
        <Info>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
            <Typography variant="body2" fontWeight={500}>
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
        </Info>
        {skill.installed ? (
          <Button
            size="small"
            variant="outlined"
            color="secondary"
            onClick={handleUninstall}
            disabled={toggleMutation.isPending}
            startIcon={toggleMutation.isPending ? <CircularProgress size={12} /> : <Trash2 size={12} />}
            sx={{ ml: 'auto', minWidth: 'auto', px: 1.5 }}
          >
            {toggleMutation.isPending ? 'Removing...' : 'Uninstall'}
          </Button>
        ) : (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, color: 'text.secondary', ml: 'auto' }}>
            <Download size={12} />
            <Typography variant="caption">{skill.installs.toLocaleString()}</Typography>
          </Box>
        )}
        <Chip label={skill.author} size="small" variant="outlined" />
      </Header>
      {skill.description && (
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ display: 'block', width: '100%', whiteSpace: 'pre-wrap' }}
        >
          {skill.description}
        </Typography>
      )}
    </Root>
  );
}
