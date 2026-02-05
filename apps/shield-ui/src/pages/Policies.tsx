/**
 * Policies page - grid view with inline editor
 */

import { useState, useCallback } from 'react';
import {
  Box,
  Button,
  Card,
  CardContent,
  Collapse,
} from '@mui/material';
import { Plus, ShieldCheck } from 'lucide-react';
import type { PolicyConfig } from '@agenshield/ipc';
import { useConfig, useUpdateConfig, useSecrets, useUpdateSecret } from '../api/hooks';
import { useAuth } from '../context/AuthContext';
import { useUnsavedChangesGuard } from '../hooks/useUnsavedChangesGuard';
import { tokens } from '../styles/tokens';
import { PageHeader } from '../components/shared/PageHeader';
import { EmptyState } from '../components/shared/EmptyState';
import { ConfirmDialog } from '../components/shared/ConfirmDialog';
import { PolicyGrid } from '../components/policies/PolicyGrid';
import { PolicyEditor } from '../components/policies/PolicyEditor';

export function Policies() {
  const { data: config } = useConfig();
  const updateConfig = useUpdateConfig();
  const { data: secretsData } = useSecrets();
  const updateSecret = useUpdateSecret();
  const { isReadOnly } = useAuth();

  const [formOpen, setFormOpen] = useState(false);
  const [editingPolicy, setEditingPolicy] = useState<PolicyConfig | null>(null);
  const [formDirty, setFormDirty] = useState(false);
  const [formFocused, setFormFocused] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [toggleTarget, setToggleTarget] = useState<{ id: string; enabled: boolean } | null>(null);

  const { guardOpen, guardConfirm, guardCancel } = useUnsavedChangesGuard(formDirty);

  const policies = config?.data?.policies ?? [];
  const secrets = secretsData?.data ?? [];

  const confirmToggle = (id: string, enabled: boolean) => {
    const updatedPolicies = policies.map((p) =>
      p.id === id ? { ...p, enabled } : p
    );
    updateConfig.mutate({ policies: updatedPolicies });
  };

  const requestToggle = (id: string, enabled: boolean) => {
    setToggleTarget({ id, enabled });
  };

  const handleEdit = (policy: PolicyConfig) => {
    setEditingPolicy(policy);
    setFormOpen(true);
  };

  const handleDelete = (id: string) => {
    setDeleteTarget(id);
  };

  const confirmDelete = () => {
    if (deleteTarget) {
      const updatedPolicies = policies.filter((p) => p.id !== deleteTarget);
      updateConfig.mutate({ policies: updatedPolicies });
      setDeleteTarget(null);
    }
  };

  const handleAdd = () => {
    setEditingPolicy(null);
    setFormOpen(true);
  };

  const handleCancel = useCallback(() => {
    setFormOpen(false);
    setEditingPolicy(null);
    setFormDirty(false);
    setFormFocused(false);
  }, []);

  const handleSave = (newPolicy: PolicyConfig, linkedSecretIds: string[]) => {
    const updatedPolicies = editingPolicy
      ? policies.map((p) => (p.id === editingPolicy.id ? newPolicy : p))
      : [...policies, newPolicy];

    updateConfig.mutate(
      { policies: updatedPolicies },
      {
        onSuccess: () => {
          // Update secret linkage: for each secret, add/remove this policy ID
          const policyId = newPolicy.id;
          for (const secret of secrets) {
            const isLinked = linkedSecretIds.includes(secret.id);
            const wasLinked = secret.policyIds.includes(policyId);

            if (isLinked && !wasLinked) {
              updateSecret.mutate({ id: secret.id, policyIds: [...secret.policyIds, policyId] });
            } else if (!isLinked && wasLinked) {
              updateSecret.mutate({ id: secret.id, policyIds: secret.policyIds.filter((pid) => pid !== policyId) });
            }
          }

          setFormOpen(false);
          setEditingPolicy(null);
          setFormDirty(false);
          setFormFocused(false);
        },
      },
    );
  };

  return (
    <Box sx={{ maxWidth: tokens.page.maxWidth, mx: 'auto' }}>
      <PageHeader
        title="Policies"
        description="Manage security policies for command, skill, and URL filtering."
        action={
          !formOpen ? (
            <Button variant="contained" startIcon={<Plus size={16} />} onClick={handleAdd} disabled={isReadOnly}>
              Add Policy
            </Button>
          ) : undefined
        }
      />

      <Collapse in={formOpen} unmountOnExit timeout={250}>
        <Box sx={{ mb: 3, position: 'relative', zIndex: 10 }}>
          <PolicyEditor
            policy={editingPolicy}
            onSave={handleSave}
            onCancel={handleCancel}
            onDirtyChange={setFormDirty}
            onFocusChange={setFormFocused}
            error={updateConfig.isError}
          />
        </Box>
      </Collapse>

      <Card sx={{ opacity: formFocused ? 0.45 : 1, transition: 'opacity 0.2s ease', pointerEvents: formFocused ? 'none' : 'auto' }}>
        <CardContent>
          {policies.length === 0 ? (
            <EmptyState
              icon={<ShieldCheck size={28} />}
              title="No policies configured"
              description="Add your first policy to get started with command, skill, and URL filtering."
              action={
                !formOpen ? (
                  <Button variant="contained" startIcon={<Plus size={16} />} onClick={handleAdd}>
                    Add Policy
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <PolicyGrid
              policies={policies}
              onToggle={requestToggle}
              onEdit={handleEdit}
              onDelete={handleDelete}
              disabled={updateConfig.isPending || isReadOnly}
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
        title="Delete Policy"
        message="Are you sure you want to delete this policy? This action cannot be undone."
        confirmLabel="Delete"
        variant="danger"
        position="top"
        onConfirm={confirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />

      <ConfirmDialog
        open={!!toggleTarget}
        title={toggleTarget?.enabled ? 'Enable Policy' : 'Disable Policy'}
        message={`Are you sure you want to ${toggleTarget?.enabled ? 'enable' : 'disable'} this policy?`}
        confirmLabel={toggleTarget?.enabled ? 'Enable' : 'Disable'}
        position="top"
        onConfirm={() => {
          if (toggleTarget) {
            confirmToggle(toggleTarget.id, toggleTarget.enabled);
            setToggleTarget(null);
          }
        }}
        onCancel={() => setToggleTarget(null)}
      />
    </Box>
  );
}
