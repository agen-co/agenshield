/**
 * Full-page skill detail — renders local or marketplace skill based on slug
 */

import { Box, Button, Skeleton } from '@mui/material';
import { ArrowLeft } from 'lucide-react';
import { useParams, useNavigate } from 'react-router-dom';
import { useSkills } from '../api/hooks';
import { tokens } from '../styles/tokens';
import { SkillDetails } from '../components/skills/SkillDetails';
import { MarketplaceSkillDetails } from '../components/skills/MarketplaceSkillDetails';

export function SkillPage() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const { data: skillsData, isLoading: skillsLoading } = useSkills();

  if (!slug) return null;

  const localSkill = skillsData?.data?.find((s) => s.name === slug);

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

      {skillsLoading ? (
        <Box>
          <Skeleton variant="text" width="60%" height={40} />
          <Skeleton variant="rectangular" height={200} sx={{ mt: 2, borderRadius: 1 }} />
        </Box>
      ) : localSkill ? (
        <SkillDetails skillName={slug} />
      ) : (
        <MarketplaceSkillDetails slug={slug} />
      )}
    </Box>
  );
}
