/**
 * Secrets page - manage environment secrets by scope
 */

import { useState, useCallback } from 'react';
import {
  Box,
  Card,
  CardContent,
  Collapse,
  Button,
  Skeleton,
} from '@mui/material';
import { Plus, KeyRound } from 'lucide-react';
import { useSecrets, useCreateSecret, useDeleteSecret } from '../api/hooks';
import { useAuth } from '../context/AuthContext';
import { useUnsavedChangesGuard } from '../hooks/useUnsavedChangesGuard';
import { tokens } from '../styles/tokens';
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
  const { isReadOnly } = useAuth();

  const [search, setSearch] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [formDirty, setFormDirty] = useState(false);
  const [formFocused, setFormFocused] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  const { guardOpen, guardConfirm, guardCancel } = useUnsavedChangesGuard(formDirty);

  const secrets = data?.data ?? [];

  const handleSave = (req: CreateSecretRequest) => {
    createSecret.mutate(req, {
      onSuccess: () => {
        setFormOpen(false);
        setFormDirty(false);
        setFormFocused(false);
      },
    });
  };

  const handleCancel = useCallback(() => {
    setFormOpen(false);
    setFormDirty(false);
    setFormFocused(false);
  }, []);

  const confirmDelete = () => {
    if (deleteTarget) {
      deleteSecret.mutate(deleteTarget);
      setDeleteTarget(null);
    }
  };

  return (
    <Box sx={{ maxWidth: tokens.page.maxWidth, mx: 'auto' }}>
      <PageHeader
        title="Secrets"
        description="Manage secrets and link them to policies for scoped injection."
        action={
          !formOpen ? (
            <Button variant="contained" startIcon={<Plus size={16} />} onClick={() => setFormOpen(true)} disabled={isReadOnly}>
              Add Secret
            </Button>
          ) : undefined
        }
      />

      <Collapse in={formOpen} unmountOnExit timeout={250}>
        <Box sx={{ mb: 3, position: 'relative', zIndex: 10 }}>
          <SecretForm
            onSave={handleSave}
            onCancel={handleCancel}
            onDirtyChange={setFormDirty}
            onFocusChange={setFormFocused}
            saving={createSecret.isPending}
          />
        </Box>
      </Collapse>

      <Box sx={{ mb: 3, opacity: formFocused ? 0.45 : 1, transition: 'opacity 0.2s ease', pointerEvents: formFocused ? 'none' : 'auto' }}>
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Search secrets..."
        />
      </Box>

      <Card sx={{ opacity: formFocused ? 0.45 : 1, transition: 'opacity 0.2s ease', pointerEvents: formFocused ? 'none' : 'auto' }}>
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
                !formOpen ? (
                  <Button variant="contained" startIcon={<Plus size={16} />} onClick={() => setFormOpen(true)} disabled={isReadOnly}>
                    Add Secret
                  </Button>
                ) : undefined
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

      <ConfirmDialog
        open={guardOpen}
        title="Unsaved Changes"
        message="You have unsaved changes. Discard them?"
        confirmLabel="Discard"
        variant="danger"
        position="top"
        onConfirm={guardConfirm}
        onCancel={guardCancel}
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
