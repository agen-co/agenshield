/**
 * Policies page - tabbed layout (Commands / Network / Filesystem)
 * Tab selection is driven by the URL: /policies/commands, /policies/network, /policies/filesystem
 */

import { useState, useCallback, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Box,
  Button,
  Card,
  CardContent,
  Collapse,
  Tabs,
  Tab,
} from '@mui/material';
import { Plus, Terminal, Globe, FolderOpen } from 'lucide-react';
import type { PolicyConfig } from '@agenshield/ipc';
import { useConfig, useUpdateConfig, useSecrets, useUpdateSecret, useSkills } from '../api/hooks';
import { useGuardedAction } from '../hooks/useGuardedAction';
import { useUnsavedChangesGuard } from '../hooks/useUnsavedChangesGuard';
import { tokens } from '../styles/tokens';
import { PageHeader } from '../components/shared/PageHeader';
import { EmptyState } from '../components/shared/EmptyState';
import { ConfirmDialog } from '../components/shared/ConfirmDialog';
import { PolicyEditor } from '../components/policies/PolicyEditor';
import { CommandPolicyList } from '../components/policies/CommandPolicyList';
import { NetworkPolicyList } from '../components/policies/NetworkPolicyList';
import { FilesystemPolicyTable } from '../components/policies/FilesystemPolicyTable';

const TAB_SLUGS = ['commands', 'network', 'filesystem'] as const;
const TAB_TARGETS: Record<string, 'command' | 'url' | 'filesystem'> = {
  commands: 'command',
  network: 'url',
  filesystem: 'filesystem',
};

export function Policies() {
  const { tab } = useParams<{ tab: string }>();
  const navigate = useNavigate();

  const activeTab = Math.max(0, TAB_SLUGS.indexOf(tab as any));
  const activeTarget = TAB_TARGETS[TAB_SLUGS[activeTab]];

  const { data: config } = useConfig();
  const updateConfig = useUpdateConfig();
  const { data: secretsData } = useSecrets();
  const updateSecret = useUpdateSecret();
  const { data: skillsData } = useSkills();
  const guard = useGuardedAction();

  const [formOpen, setFormOpen] = useState(false);
  const [editingPolicy, setEditingPolicy] = useState<PolicyConfig | null>(null);
  const [formDirty, setFormDirty] = useState(false);
  const [formFocused, setFormFocused] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [toggleTarget, setToggleTarget] = useState<{ id: string; enabled: boolean } | null>(null);

  const { guardOpen, guardConfirm, guardCancel } = useUnsavedChangesGuard(formDirty);

  const policies = config?.data?.policies ?? [];
  const secrets = secretsData?.data ?? [];
  const skills = skillsData?.data ?? [];

  // Filter policies by target
  const commandPolicies = useMemo(() => policies.filter((p) => p.target === 'command'), [policies]);
  const networkPolicies = useMemo(() => policies.filter((p) => p.target === 'url'), [policies]);
  const filesystemPolicies = useMemo(() => policies.filter((p) => p.target === 'filesystem'), [policies]);

  // Check if any installed skills have commands (for empty state)
  const hasSkillCommands = useMemo(
    () => skills.some((s) => s.status === 'active' && (s as any).analysis?.commands?.length),
    [skills],
  );

  const confirmToggle = (id: string, enabled: boolean) => {
    const updatedPolicies = policies.map((p) =>
      p.id === id ? { ...p, enabled } : p
    );
    updateConfig.mutate({ policies: updatedPolicies });
  };

  const requestToggle = useCallback((id: string, enabled: boolean) => {
    guard(() => setToggleTarget({ id, enabled }), {
      description: `Unlock to ${enabled ? 'enable' : 'disable'} this policy.`,
      actionLabel: enabled ? 'Enable' : 'Disable',
    });
  }, [guard]);

  const handleEdit = useCallback((policy: PolicyConfig) => {
    guard(() => {
      setEditingPolicy(policy);
      setFormOpen(true);
    }, { description: 'Unlock to edit this policy.', actionLabel: 'Edit Policy' });
  }, [guard]);

  const handleDelete = useCallback((id: string) => {
    guard(() => setDeleteTarget(id), {
      description: 'Unlock to delete this policy.',
      actionLabel: 'Delete Policy',
    });
  }, [guard]);

  const confirmDelete = () => {
    if (deleteTarget) {
      const updatedPolicies = policies.filter((p) => p.id !== deleteTarget);
      updateConfig.mutate({ policies: updatedPolicies });
      setDeleteTarget(null);
    }
  };

  const handleAdd = () => {
    guard(() => {
      setEditingPolicy(null);
      setFormOpen(true);
    }, { description: 'Unlock to add a new policy.', actionLabel: 'Add Policy' });
  };

  const handleCancel = useCallback(() => {
    setFormOpen(false);
    setEditingPolicy(null);
    setFormDirty(false);
    setFormFocused(false);
  }, []);

  const handleSave = (newPolicy: PolicyConfig, linkedSecretIds: string[]) => {
    const isUpdate = editingPolicy && policies.some((p) => p.id === editingPolicy.id);
    const updatedPolicies = isUpdate
      ? policies.map((p) => (p.id === editingPolicy!.id ? newPolicy : p))
      : [...policies, newPolicy];

    updateConfig.mutate(
      { policies: updatedPolicies },
      {
        onSuccess: () => {
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

  // Filesystem inline handlers
  const handleFsUpdate = (policy: PolicyConfig) => {
    guard(() => {
      const updatedPolicies = policies.map((p) => (p.id === policy.id ? policy : p));
      updateConfig.mutate({ policies: updatedPolicies });
    }, { description: 'Unlock to modify this filesystem policy.', actionLabel: 'Modify Policy' });
  };

  const handleFsAdd = (policy: PolicyConfig) => {
    guard(() => {
      updateConfig.mutate({ policies: [...policies, policy] });
    }, { description: 'Unlock to add a filesystem policy.', actionLabel: 'Add Policy' });
  };

  const handleAddSkillPolicy = useCallback(
    (skillSlug: string, skillName: string, commandName: string) => {
      guard(() => {
        const colonIdx = commandName.indexOf(':');
        const baseName = colonIdx >= 0 ? commandName.slice(0, colonIdx) : commandName;
        const draft: PolicyConfig = {
          id: crypto.randomUUID(),
          name: baseName,
          action: 'allow',
          target: 'command',
          patterns: [`${baseName}:*`],
          enabled: true,
          preset: `skill:${skillSlug}`,
        };
        setEditingPolicy(draft);
        setFormOpen(true);
      }, { description: 'Unlock to add a skill command policy.', actionLabel: 'Add Policy' });
    },
    [guard],
  );

  const handleTabChange = (_e: React.SyntheticEvent, newTab: number) => {
    navigate(`/policies/${TAB_SLUGS[newTab]}`, { replace: true });
    // Close editor when switching tabs (if not dirty)
    if (formOpen && !formDirty) {
      handleCancel();
    }
  };

  return (
    <Box sx={{ maxWidth: tokens.page.maxWidth, mx: 'auto' }}>
      <PageHeader
        title="Policies"
        description="Manage security policies for command, URL, and filesystem filtering."
      />

      {/* Collapsible editor for Commands + Network tabs */}
      {activeTab !== 2 && (
        <Collapse in={formOpen} unmountOnExit timeout={250}>
          <Box sx={{ mb: 3, position: 'relative', zIndex: 10 }}>
            <PolicyEditor
              policy={editingPolicy}
              defaultTarget={editingPolicy ? editingPolicy.target : activeTarget}
              onSave={handleSave}
              onCancel={handleCancel}
              onDirtyChange={setFormDirty}
              onFocusChange={setFormFocused}
              error={updateConfig.isError}
            />
          </Box>
        </Collapse>
      )}

      <Card sx={{ p: 0, opacity: formFocused ? 0.45 : 1, transition: 'opacity 0.2s ease', pointerEvents: formFocused ? 'none' : 'auto' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', borderBottom: 1, borderColor: 'divider' }}>
          <Tabs value={activeTab} onChange={handleTabChange} sx={{ flex: 1 }}>
            <Tab
              icon={<Terminal size={14} />}
              iconPosition="start"
              label="Commands"
              sx={{ minHeight: 48, textTransform: 'none' }}
            />
            <Tab
              icon={<Globe size={14} />}
              iconPosition="start"
              label="Network"
              sx={{ minHeight: 48, textTransform: 'none' }}
            />
            <Tab
              icon={<FolderOpen size={14} />}
              iconPosition="start"
              label="Filesystem"
              sx={{ minHeight: 48, textTransform: 'none' }}
            />
          </Tabs>

          {/* Add button — only for Commands and Network tabs */}
          {!formOpen && activeTab !== 2 && (
            <Box sx={{ pr: 2 }}>
              <Button
                size="small"
                variant="contained"
                startIcon={<Plus size={14} />}
                onClick={handleAdd}
              >
                Add Policy
              </Button>
            </Box>
          )}
        </Box>

        <CardContent sx={{ p: 0, '&:last-child': { pb: 0 } }}>
          {/* Tab 0: Commands */}
          {activeTab === 0 && (
            commandPolicies.length === 0 && !hasSkillCommands ? (
              <EmptyState
                icon={<Terminal size={28} />}
                title="No command policies"
                description="Add a command policy to control which CLI commands agents can execute."
                action={
                  !formOpen ? (
                    <Button variant="contained" startIcon={<Plus size={16} />} onClick={handleAdd}>
                      Add Policy
                    </Button>
                  ) : undefined
                }
              />
            ) : (
              <CommandPolicyList
                policies={commandPolicies}
                skills={skills}
                onToggle={requestToggle}
                onEdit={handleEdit}
                onDelete={handleDelete}
                onAddSkillPolicy={handleAddSkillPolicy}
                readOnly={false}
                busy={updateConfig.isPending}
              />
            )
          )}

          {/* Tab 1: Network */}
          {activeTab === 1 && (
            networkPolicies.length === 0 ? (
              <EmptyState
                icon={<Globe size={28} />}
                title="No network policies"
                description="Add a URL policy to control which endpoints agents can access."
                action={
                  !formOpen ? (
                    <Button variant="contained" startIcon={<Plus size={16} />} onClick={handleAdd}>
                      Add Policy
                    </Button>
                  ) : undefined
                }
              />
            ) : (
              <NetworkPolicyList
                policies={networkPolicies}
                onToggle={requestToggle}
                onEdit={handleEdit}
                onDelete={handleDelete}
                readOnly={false}
                busy={updateConfig.isPending}
              />
            )
          )}

          {/* Tab 2: Filesystem (inline editing — always show table with add row) */}
          {activeTab === 2 && (
            <FilesystemPolicyTable
              policies={filesystemPolicies}
              onToggle={requestToggle}
              onUpdate={handleFsUpdate}
              onAdd={handleFsAdd}
              onDelete={handleDelete}
              readOnly={false}
              busy={updateConfig.isPending}
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
