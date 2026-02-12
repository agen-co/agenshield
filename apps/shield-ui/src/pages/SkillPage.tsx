/**
 * Full-page skill detail — unified view for all skill origins
 */

import { useEffect } from 'react';
import { Alert, Box, Button, Skeleton } from '@mui/material';
import { ArrowLeft } from 'lucide-react';
import { useParams, useNavigate } from 'react-router-dom';
import { useSnapshot } from 'valtio';
import { tokens } from '../styles/tokens';
import { SkillDetails } from '../components/skills/SkillDetails';
import { skillsStore, fetchSkillDetail } from '../stores/skills';

export function SkillPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const snap = useSnapshot(skillsStore);

  useEffect(() => {
    if (id) {
      skillsStore.selectedId = id;
      // Fetch detail if not already loaded
      const existing = skillsStore.skills.find(
        (s) => s.installationId === id || s.slug === id || s.name === id,
      );
      if (!existing?.detailLoaded) {
        fetchSkillDetail(id);
      }
    }
  }, [id]);

  const selectedSkill = snap.skills.find(
    (s) => s.installationId === snap.selectedId || s.slug === snap.selectedId || s.name === snap.selectedId,
  );

  if (!id) return null;

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

      {snap.selectedLoading ? (
        <Box>
          <Skeleton variant="text" width="60%" height={40} />
          <Skeleton variant="rectangular" height={200} sx={{ mt: 2, borderRadius: 1 }} />
        </Box>
      ) : !selectedSkill ? (
        <Alert severity="info">Skill not found</Alert>
      ) : (
        <SkillDetails />
      )}
    </Box>
  );
}
