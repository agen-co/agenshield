/**
 * Full-page skill detail — unified view for all skill origins
 */

import { useEffect } from 'react';
import { Box, Button, Skeleton } from '@mui/material';
import { ArrowLeft } from 'lucide-react';
import { useParams, useNavigate } from 'react-router-dom';
import { useSnapshot } from 'valtio';
import { tokens } from '../styles/tokens';
import { SkillDetails } from '../components/skills/SkillDetails';
import { skillsStore, fetchSkillDetail } from '../stores/skills';

export function SkillPage() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const snap = useSnapshot(skillsStore);

  useEffect(() => {
    if (slug) {
      skillsStore.selectedSlug = slug;
      // Fetch detail if not already loaded
      const existing = skillsStore.skills.find((s) => s.slug === slug || s.name === slug);
      if (!existing?.detailLoaded) {
        fetchSkillDetail(slug);
      }
    }
  }, [slug]);

  // Navigate back if the skill was deleted (e.g. from detail page)
  useEffect(() => {
    if (slug && !snap.selectedLoading) {
      const exists = snap.skills.some((s) => s.slug === slug || s.name === slug);
      if (!exists && snap.skills.length > 0) {
        navigate('/skills', { replace: true });
      }
    }
  }, [slug, snap.skills, snap.selectedLoading, navigate]);

  const selectedSkill = snap.skills.find((s) => s.slug === snap.selectedSlug || s.name === snap.selectedSlug);

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

      {snap.selectedLoading && !selectedSkill ? (
        <Box>
          <Skeleton variant="text" width="60%" height={40} />
          <Skeleton variant="rectangular" height={200} sx={{ mt: 2, borderRadius: 1 }} />
        </Box>
      ) : (
        <SkillDetails />
      )}
    </Box>
  );
}
