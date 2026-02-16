/**
 * Profiles list page — placeholder
 */

import { Box, Button, Card, CardContent, Typography, Chip } from '@mui/material';
import { Plus, User } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useProfiles } from '../api/hooks';
import { tokens } from '../styles/tokens';
import { PageHeader } from '../components/shared/PageHeader';
import { EmptyState } from '../components/shared/EmptyState';

export function ProfilesPage() {
  const navigate = useNavigate();
  const { data: profilesResp } = useProfiles();
  const profiles = profilesResp?.data ?? [];

  return (
    <Box sx={{ maxWidth: tokens.page.maxWidth, mx: 'auto' }}>
      <PageHeader
        title="Profiles"
        description="Manage agent profiles and their configurations."
        action={
          <Button variant="contained" startIcon={<Plus size={16} />} disabled>
            Create Profile
          </Button>
        }
      />

      {profiles.length === 0 ? (
        <EmptyState
          icon={<User size={28} />}
          title="No profiles"
          description="Profiles will appear here once created via the CLI."
        />
      ) : (
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 2 }}>
          {profiles.map((profile) => (
            <Card
              key={profile.id}
              sx={{ cursor: 'pointer', '&:hover': { borderColor: 'text.secondary' } }}
              onClick={() => navigate(`/profiles/${profile.id}`)}
            >
              <CardContent>
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
                  <Typography variant="subtitle1">{profile.name}</Typography>
                  <Chip label={profile.type} size="small" variant="outlined" />
                </Box>
                {profile.description && (
                  <Typography variant="body2" color="text.secondary">
                    {profile.description}
                  </Typography>
                )}
              </CardContent>
            </Card>
          ))}
        </Box>
      )}
    </Box>
  );
}
