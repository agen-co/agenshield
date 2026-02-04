/**
 * Secrets page - manage environment secrets by scope
 */

import { useState } from 'react';
import {
  Box,
  Card,
  CardContent,
  Button,
  Skeleton,
} from '@mui/material';
import { Plus, KeyRound } from 'lucide-react';
import { useSecrets, useCreateSecret, useDeleteSecret } from '../api/hooks';
import type { CreateSecretRequest } from '../api/client';
import { PageHeader } from '../components/shared/PageHeader';
import { SearchInput } from '../components/shared/SearchInput';
import { EmptyState } from '../components/shared/EmptyState';
import { ConfirmDialog } from '../components/shared/ConfirmDialog';
import { SecretsList } from '../components/secrets/SecretsList';
import { SecretForm } from '../components/secrets/SecretForm';

export function Secrets() {
  const { data, isLoading } = useSecrets();
  const createSecret = useCreateSecret();
  const deleteSecret = useDeleteSecret();

  const [search, setSearch] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  const secrets = data?.data ?? [];

  const handleSave = (req: CreateSecretRequest) => {
    createSecret.mutate(req, {
      onSuccess: () => setFormOpen(false),
    });
  };

  const confirmDelete = () => {
    if (deleteTarget) {
      deleteSecret.mutate(deleteTarget);
      setDeleteTarget(null);
    }
  };

  return (
    <Box>
      <PageHeader
        title="Secrets"
        description="Manage secrets injected into operations by scope."
        action={
          <Button variant="contained" startIcon={<Plus size={16} />} onClick={() => setFormOpen(true)}>
            Add Secret
          </Button>
        }
      />

      <Box sx={{ mb: 3 }}>
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Search secrets..."
        />
      </Box>

      <Card>
        <CardContent sx={{ p: 0 }}>
          {isLoading ? (
            <Box sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 1 }}>
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} variant="rectangular" height={48} sx={{ borderRadius: 1 }} />
              ))}
            </Box>
          ) : secrets.length === 0 ? (
            <EmptyState
              icon={<KeyRound size={28} />}
              title="No secrets configured"
              description="Add secrets to inject environment variables, API keys, and credentials into operations."
              action={
                <Button variant="contained" startIcon={<Plus size={16} />} onClick={() => setFormOpen(true)}>
                  Add Secret
                </Button>
              }
            />
          ) : (
            <SecretsList
              secrets={secrets}
              search={search}
              onDelete={setDeleteTarget}
            />
          )}
        </CardContent>
      </Card>

      <SecretForm
        open={formOpen}
        onClose={() => setFormOpen(false)}
        onSave={handleSave}
        saving={createSecret.isPending}
      />

      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete Secret"
        message="Are you sure you want to delete this secret? This action cannot be undone."
        confirmLabel="Delete"
        variant="danger"
        onConfirm={confirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </Box>
  );
}
