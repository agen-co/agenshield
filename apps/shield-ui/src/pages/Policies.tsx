/**
 * Policies page - grid view with detail panel
 */

import { useState } from 'react';
import {
  Box,
  Button,
  Alert,
  Typography,
} from '@mui/material';
import { Plus, ShieldCheck } from 'lucide-react';
import type { PolicyConfig } from '@agenshield/ipc';
import { useConfig, useUpdateConfig } from '../api/hooks';
import { PageHeader } from '../components/shared/PageHeader';
import { EmptyState } from '../components/shared/EmptyState';
import { ConfirmDialog } from '../components/shared/ConfirmDialog';
import { SidePanel } from '../components/shared/SidePanel';
import { PolicyGrid } from '../components/policies/PolicyGrid';
import { PolicyEditor } from '../components/policies/PolicyEditor';

export function Policies() {
  const { data: config } = useConfig();
  const updateConfig = useUpdateConfig();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingPolicy, setEditingPolicy] = useState<PolicyConfig | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  const policies = config?.data?.policies ?? [];
  const selectedPolicy = policies.find((p) => p.id === selectedId);

  const handleToggle = (id: string, enabled: boolean) => {
    const updatedPolicies = policies.map((p) =>
      p.id === id ? { ...p, enabled } : p
    );
    updateConfig.mutate({ policies: updatedPolicies });
  };

  const handleEdit = (policy: PolicyConfig) => {
    setEditingPolicy(policy);
    setDialogOpen(true);
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
    setDialogOpen(true);
  };

  const handleSave = (newPolicy: PolicyConfig) => {
    const updatedPolicies = editingPolicy
      ? policies.map((p) => (p.id === editingPolicy.id ? newPolicy : p))
      : [...policies, newPolicy];

    updateConfig.mutate({ policies: updatedPolicies });
    setDialogOpen(false);
  };

  return (
    <Box>
      <PageHeader
        title="Policies"
        description="Manage security policies for command and URL filtering."
        action={
          <Button variant="contained" startIcon={<Plus size={16} />} onClick={handleAdd}>
            Add Policy
          </Button>
        }
      />

      {updateConfig.isError && (
        <Alert severity="error" sx={{ mb: 2 }}>
          Failed to update policies. Please try again.
        </Alert>
      )}

      {policies.length === 0 ? (
        <EmptyState
          icon={<ShieldCheck size={28} />}
          title="No policies configured"
          description="Add your first policy to get started with command and URL filtering."
          action={
            <Button variant="contained" startIcon={<Plus size={16} />} onClick={handleAdd}>
              Add Policy
            </Button>
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
          disabled={updateConfig.isPending}
        />
      )}

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
            <Typography variant="body2" color="text.secondary" gutterBottom>
              Type: {selectedPolicy.type} | {selectedPolicy.enabled ? 'Enabled' : 'Disabled'}
            </Typography>
            <Typography variant="subtitle2" sx={{ mt: 2, mb: 1 }}>
              Patterns ({selectedPolicy.patterns.length})
            </Typography>
            <Box
              sx={{
                fontFamily: 'monospace',
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

      <PolicyEditor
        open={dialogOpen}
        policy={editingPolicy}
        onSave={handleSave}
        onClose={() => setDialogOpen(false)}
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
    </Box>
  );
}
