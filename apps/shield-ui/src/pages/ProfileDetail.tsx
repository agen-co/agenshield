/**
 * Profile detail page — placeholder
 */

import { Box, Card, CardContent, Typography, Chip, Button } from '@mui/material';
import { ArrowLeft, ShieldCheck, Zap, KeyRound, Variable } from 'lucide-react';
import { useParams, useNavigate } from 'react-router-dom';
import { useProfiles } from '../api/hooks';
import { tokens } from '../styles/tokens';
import { PageHeader } from '../components/shared/PageHeader';

const SUB_PAGES = [
  { label: 'Policies', path: 'policies', icon: ShieldCheck },
  { label: 'Skills', path: 'skills', icon: Zap },
  { label: 'Secrets', path: 'secrets', icon: KeyRound },
  { label: 'Env Vars', path: 'env', icon: Variable },
] as const;

export function ProfileDetail() {
  const { profileId } = useParams<{ profileId: string }>();
  const navigate = useNavigate();
  const { data: profilesResp } = useProfiles();
  const profile = profilesResp?.data?.find((p) => p.id === profileId);

  return (
    <Box sx={{ maxWidth: tokens.page.maxWidth, mx: 'auto' }}>
      <Button
        size="small"
        startIcon={<ArrowLeft size={14} />}
        onClick={() => navigate('/profiles')}
        sx={{ mb: 1, textTransform: 'none' }}
      >
        All Profiles
      </Button>

      <PageHeader
        title={profile?.name ?? profileId ?? 'Profile'}
        description={profile?.description ?? 'Profile configuration and resources.'}
      />

      {profile && (
        <Box sx={{ mb: 3, display: 'flex', gap: 1 }}>
          <Chip label={profile.type} size="small" variant="outlined" />
          {profile.targetName && <Chip label={profile.targetName} size="small" />}
        </Box>
      )}

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 2 }}>
        {SUB_PAGES.map(({ label, path, icon: Icon }) => (
          <Card
            key={path}
            sx={{ cursor: 'pointer', '&:hover': { borderColor: 'text.secondary' } }}
            onClick={() => navigate(`/profiles/${profileId}/${path}`)}
          >
            <CardContent sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              <Icon size={20} />
              <Typography variant="subtitle1">{label}</Typography>
            </CardContent>
          </Card>
        ))}
      </Box>
    </Box>
  );
}
