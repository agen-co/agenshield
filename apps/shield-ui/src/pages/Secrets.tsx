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
  Alert,
} from '@mui/material';
import { Plus, KeyRound } from 'lucide-react';
import { useSecrets, useCreateSecret, useDeleteSecret } from '../api/hooks';
import { useGuardedAction } from '../hooks/useGuardedAction';
import { useUnsavedChangesGuard } from '../hooks/useUnsavedChangesGuard';
import { tokens } from '../styles/tokens';
import type { CreateSecretRequest, Secret, SecretScope } from '../api/client';

import { PageHeader } from '../components/shared/PageHeader';
import { SearchInput } from '../components/shared/SearchInput';
import { EmptyState } from '../components/shared/EmptyState';
import { ConfirmDialog } from '../components/shared/ConfirmDialog';
import { SecretsList } from '../components/secrets/SecretsList';
import { SecretForm } from '../components/secrets/SecretForm';
import { SkillEnvSection } from '../components/secrets/SkillEnvSection';

interface PrefillData {
  name: string;
  policyIds: string[];
  scope?: SecretScope;
}

export function Secrets() {
  const { data, isLoading } = useSecrets();
  const createSecret = useCreateSecret();
  const deleteSecret = useDeleteSecret();
  const guard = useGuardedAction();

  const [search, setSearch] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [formDirty, setFormDirty] = useState(false);
  const [formFocused, setFormFocused] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [editingSecret, setEditingSecret] = useState<Secret | null>(null);
  const [prefillData, setPrefillData] = useState<PrefillData | null>(null);

  const { guardOpen, guardConfirm, guardCancel } = useUnsavedChangesGuard(formDirty);

  const secrets = data?.data ?? [];

  const handleSave = (req: CreateSecretRequest) => {
    const doCreate = () => {
      createSecret.mutate(req, {
        onSuccess: () => {
          setFormOpen(false);
          setEditingSecret(null);
          setPrefillData(null);
          setFormDirty(false);
          setFormFocused(false);
        },
      });
    };

    if (editingSecret) {
      deleteSecret.mutate(editingSecret.id, { onSuccess: doCreate });
    } else {
      doCreate();
    }
  };

  const handleCancel = useCallback(() => {
    setFormOpen(false);
    setEditingSecret(null);
    setPrefillData(null);
    setFormDirty(false);
    setFormFocused(false);
  }, []);

  const handleEdit = (secret: Secret) => {
    setPrefillData(null);
    setEditingSecret(secret);
    setFormOpen(true);
  };

  const handleAddFromSkillEnv = (envName: string) => {
    guard(() => {
      setEditingSecret(null);
      setPrefillData({ name: envName, policyIds: [], scope: 'standalone' });
      setFormOpen(true);
    }, { description: 'Unlock to add a secret.', actionLabel: 'Add Secret' });
  };

  const confirmDelete = () => {
    if (deleteTarget) {
      deleteSecret.mutate(deleteTarget, {
        onSuccess: () => setDeleteTarget(null),
        onError: (err) => {
          setDeleteTarget(null);
          setDeleteError((err as Error).message);
        },
      });
    }
  };

  // Compute initialData for the form
  const formInitialData = editingSecret
    ? { name: editingSecret.name, policyIds: editingSecret.policyIds, scope: editingSecret.scope }
    : prefillData ?? undefined;

  return (
    <Box sx={{ maxWidth: tokens.page.maxWidth, mx: 'auto' }}>
      <PageHeader
        title="Secrets"
        description="Manage secrets and link them to policies for scoped injection."
        action={
          !formOpen ? (
            <Button variant="contained" startIcon={<Plus size={16} />} onClick={() => guard(() => setFormOpen(true), { description: 'Unlock to add a secret.', actionLabel: 'Add Secret' })}>
              Add Secret
            </Button>
          ) : undefined
        }
      />

      {deleteError && (
        <Alert severity="error" variant="outlined" sx={{ mb: 2 }} onClose={() => setDeleteError(null)}>
          {deleteError}
        </Alert>
      )}

      <Collapse in={formOpen} unmountOnExit timeout={250}>
        <Box sx={{ mb: 3, position: 'relative', zIndex: 10 }}>
          <SecretForm
            onSave={handleSave}
            onCancel={handleCancel}
            onDirtyChange={setFormDirty}
            onFocusChange={setFormFocused}
            saving={createSecret.isPending}
            initialData={formInitialData}
          />
        </Box>
      </Collapse>

      <SkillEnvSection onAddSecret={handleAddFromSkillEnv} disabled={formFocused} />

      <Box sx={{ mb: 3, opacity: formFocused ? 0.45 : 1, transition: 'opacity 0.2s ease', pointerEvents: formFocused ? 'none' : 'auto' }}>
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Search secrets..."
        />
      </Box>

      <Card sx={{ p:0, opacity: formFocused ? 0.45 : 1, transition: 'opacity 0.2s ease', pointerEvents: formFocused ? 'none' : 'auto' }}>
        <CardContent >
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
                  <Button variant="contained" startIcon={<Plus size={16} />} onClick={() => guard(() => setFormOpen(true), { description: 'Unlock to add a secret.', actionLabel: 'Add Secret' })}>
                    Add Secret
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <SecretsList
              secrets={secrets}
              search={search}
              onDelete={(id) => guard(() => setDeleteTarget(id), { description: 'Unlock to delete this secret.', actionLabel: 'Delete Secret' })}
              onEdit={(secret) => guard(() => handleEdit(secret), { description: 'Unlock to edit this secret.', actionLabel: 'Edit Secret' })}
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
        position="top"
        onConfirm={confirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </Box>
  );
}
