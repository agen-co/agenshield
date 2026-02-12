import { useState } from 'react';
import { Typography, Collapse, Box } from '@mui/material';
import Grid from '@mui/material/Grid2';
import { ShieldAlert, ChevronDown, ChevronRight } from 'lucide-react';
import { useTheme } from '@mui/material/styles';
import { UnifiedSkillCard } from '../UnifiedSkillCard';
import type { UnifiedSkill } from '../../../stores/skills';
import { SectionRoot, SectionHeader, CountBadge } from './UntrustedSkillsSection.styles';

interface UntrustedSkillsSectionProps {
  skills: readonly UnifiedSkill[];
  onCardClick: (id: string) => void;
  onAction: (skill: UnifiedSkill) => void;
  onDelete: (skill: UnifiedSkill) => void;
}

export function UntrustedSkillsSection({ skills, onCardClick, onAction, onDelete }: UntrustedSkillsSectionProps) {
  const [expanded, setExpanded] = useState(false);
  const theme = useTheme();

  if (skills.length === 0) return null;

  return (
    <SectionRoot>
      <SectionHeader onClick={() => setExpanded((prev) => !prev)}>
        <ShieldAlert size={18} color={theme.palette.warning.main} />
        <Typography variant="subtitle2" fontWeight={600} sx={{ flex: 1, textAlign: 'left' }}>
          Untrusted skills detected
        </Typography>
        <CountBadge>{skills.length}</CountBadge>
        {expanded
          ? <ChevronDown size={16} color={theme.palette.text.secondary} />
          : <ChevronRight size={16} color={theme.palette.text.secondary} />
        }
      </SectionHeader>

      <Collapse in={expanded}>
        <Box sx={{ pt: 2 }}>
          <Grid container spacing={2}>
            {skills.map((skill) => (
              <Grid key={skill.slug} size={{ xs: 12, md: 6 }}>
                <UnifiedSkillCard
                  skill={skill}
                  onClick={() => onCardClick(skill.slug)}
                  onAction={() => onAction(skill as UnifiedSkill)}
                  onDelete={() => onDelete(skill as UnifiedSkill)}
                />
              </Grid>
            ))}
          </Grid>
        </Box>
      </Collapse>
    </SectionRoot>
  );
}
