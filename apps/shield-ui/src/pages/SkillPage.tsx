/**
 * Full-page skill detail — renders local or marketplace skill based on slug
 */

import { Box, Button, Typography } from '@mui/material';
import { ArrowLeft } from 'lucide-react';
import { useParams, useNavigate } from 'react-router-dom';
import { useSkill, useSkills } from '../api/hooks';
import { tokens } from '../styles/tokens';
import { SkillDetails } from '../components/skills/SkillDetails';
import { MarketplaceSkillDetails } from '../components/skills/MarketplaceSkillDetails';

export function SkillPage() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();

  // Check if this slug matches a local skill name
  const { data: skillsData } = useSkills();
  const localSkill = skillsData?.data?.find((s) => s.name === slug);

  // Also try fetching as a single local skill (in case list is still loading)
  const { data: singleSkill } = useSkill(slug ?? null);
  const isLocal = !!localSkill || !!singleSkill?.data?.name;

  if (!slug) return null;

  return (
    <Box sx={{ maxWidth: tokens.page.maxWidth, mx: 'auto' }}>
      <Button
        size="small"
        variant="text"
        color="secondary"
        startIcon={<ArrowLeft size={16} />}
        onClick={() => navigate(-1)}
        sx={{ mb: 2 }}
      >
        Back to Skills
      </Button>

      {isLocal ? (
        <SkillDetails skillName={slug} />
      ) : (
        <MarketplaceSkillDetails slug={slug} />
      )}
    </Box>
  );
}
