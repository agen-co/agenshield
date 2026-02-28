/**
 * Full-page skill detail — unified view for all skill origins.
 *
 * Supports two modes:
 * - **Standalone**: rendered at `/skills/:id` via react-router (reads `useParams`)
 * - **Embedded**: rendered inside the Canvas PageOverlay via `skillId` + `embedded` props
 */

import { useEffect } from 'react';
import { Alert, Box, Button, Skeleton } from '@mui/material';
import { ArrowLeft } from 'lucide-react';
import { useParams, useNavigate } from 'react-router-dom';
import { useSnapshot } from 'valtio';
import { tokens } from '../styles/tokens';
import { SkillDetails } from '../components/skills/SkillDetails';
import { skillsStore, fetchSkillDetail } from '../stores/skills';

interface SkillPageProps {
  /** Skill ID passed directly (Canvas overlay mode) */
  skillId?: string;
  /** When true, omits the outer maxWidth wrapper (Canvas already provides it) */
  embedded?: boolean;
  /** When set, scopes install/uninstall actions to this target */
  targetId?: string;
}

export function SkillPage({ skillId: propId, embedded, targetId }: SkillPageProps) {
  const { id: routeId } = useParams<{ id: string }>();
  const id = propId ?? routeId;
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

  const content = (
    <>
      {!embedded && (
        <Button
          size="small"
          variant="text"
          color="secondary"
          startIcon={<ArrowLeft size={16} />}
          onClick={() => navigate('/skills')}
          sx={{ mb: 2 }}
        >
          Back to Skills
        </Button>
      )}

      {snap.selectedLoading ? (
        <Box>
          <Skeleton variant="text" width="60%" height={40} />
          <Skeleton variant="rectangular" height={200} sx={{ mt: 2, borderRadius: 1 }} />
        </Box>
      ) : !selectedSkill ? (
        <Alert severity="info">Skill not found</Alert>
      ) : (
        <SkillDetails targetId={targetId} />
      )}
    </>
  );

  if (embedded) return content;

  return (
    <Box sx={{ maxWidth: tokens.page.maxWidth, mx: 'auto' }}>
      {content}
    </Box>
  );
}
