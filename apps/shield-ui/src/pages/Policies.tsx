/**
 * Policies page - grid view with inline detail panel
 */

import { useState, useCallback } from 'react';
import {
  Box,
  Button,
  Card,
  CardContent,
  Collapse,
  Typography,
  Chip,
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
import { SidePanel } from '../components/shared/SidePanel';
import { PolicyGrid } from '../components/policies/PolicyGrid';
import { PolicyEditor } from '../components/policies/PolicyEditor';

const ACTION_LABEL: Record<string, string> = {
  allow: 'Allow',
  deny: 'Deny',
  approval: 'Approval',
};

const TARGET_LABEL: Record<string, string> = {
  command: 'Command',
  skill: 'Skill',
  url: 'URL',
};

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
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  const { guardOpen, guardConfirm, guardCancel } = useUnsavedChangesGuard(formDirty);

  const policies = config?.data?.policies ?? [];
  const secrets = secretsData?.data ?? [];
  const selectedPolicy = policies.find((p) => p.id === selectedId);

  // Count secrets linked to the selected policy
  const linkedSecretsCount = selectedPolicy
    ? secrets.filter((s) => s.policyIds.includes(selectedPolicy.id)).length
    : 0;

  const handleToggle = (id: string, enabled: boolean) => {
    const updatedPolicies = policies.map((p) =>
      p.id === id ? { ...p, enabled } : p
    );
    updateConfig.mutate({ policies: updatedPolicies });
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
      if (selectedId === deleteTarget) setSelectedId(null);
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
    <>
      <Box sx={{ maxWidth: tokens.page.maxWidth, mx: 'auto', display: 'flex' }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
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
                  selectedId={selectedId}
                  collapsed={!!selectedId}
                  onSelect={setSelectedId}
                  onToggle={handleToggle}
                  onEdit={handleEdit}
                  onDelete={handleDelete}
                  disabled={updateConfig.isPending || isReadOnly}
                />
              )}
            </CardContent>
          </Card>
        </Box>

        <SidePanel
          open={!!selectedPolicy}
          onClose={() => setSelectedId(null)}
          title="Policy Details"
        >
          {selectedPolicy && (
            <Box>
              <Typography variant="h6" fontWeight={600} gutterBottom>
                {selectedPolicy.name}
              </Typography>
              <Box sx={{ display: 'flex', gap: 1, mb: 1, flexWrap: 'wrap' }}>
                <Chip
                  size="small"
                  label={ACTION_LABEL[selectedPolicy.action]}
                  color={selectedPolicy.action === 'allow' ? 'success' : selectedPolicy.action === 'deny' ? 'error' : 'warning'}
                  sx={{ fontSize: 12 }}
                />
                <Chip
                  size="small"
                  label={TARGET_LABEL[selectedPolicy.target]}
                  variant="outlined"
                  sx={{ fontSize: 12 }}
                />
                <Chip
                  size="small"
                  label={selectedPolicy.enabled ? 'Enabled' : 'Disabled'}
                  variant="outlined"
                  sx={{ fontSize: 12 }}
                />
              </Box>
              {linkedSecretsCount > 0 && (
                <Typography variant="body2" color="text.secondary" gutterBottom>
                  {linkedSecretsCount} linked secret{linkedSecretsCount !== 1 ? 's' : ''}
                </Typography>
              )}
              <Typography variant="subtitle2" sx={{ mt: 2, mb: 1 }}>
                Patterns ({selectedPolicy.patterns.length})
              </Typography>
              <Box
                sx={{
                  fontFamily: '"IBM Plex Mono", monospace',
                  fontSize: 13,
                  p: 2,
                  bgcolor: 'action.hover',
                  borderRadius: 1,
                  maxHeight: 300,
                  overflow: 'auto',
                }}
              >
                {selectedPolicy.patterns.map((p, i) => (
                  <Box key={i} sx={{ py: 0.25 }}>{p}</Box>
                ))}
              </Box>
              <Box sx={{ mt: 3, display: 'flex', gap: 1 }}>
                <Button
                  variant="outlined"
                  color="secondary"
                  size="small"
                  onClick={() => handleEdit(selectedPolicy)}
                >
                  Edit
                </Button>
                <Button
                  variant="outlined"
                  color="error"
                  size="small"
                  onClick={() => handleDelete(selectedPolicy.id)}
                >
                  Delete
                </Button>
              </Box>
            </Box>
          )}
        </SidePanel>
      </Box>

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
        onConfirm={confirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </>
  );
}
