/**
 * Policies page - tabbed layout (Commands / Network / Filesystem)
 * Tab selection is driven by the URL: /policies/commands, /policies/network, /policies/filesystem
 *
 * Policies are organized into three tiers:
 * - Managed: Admin-enforced, read-only
 * - Global: Shared across targets (read-only in target view)
 * - Target: Per-target policies (only in scoped context)
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
  Typography,
} from '@mui/material';
import { Plus, Terminal, Globe, FolderOpen, Play, Cpu } from 'lucide-react';
import type { PolicyConfig, TieredPolicies } from '@agenshield/ipc';
import { useConfig, useSecrets, useUpdateSecret, useSkills, useTieredPolicies, useCreatePolicy, useUpdatePolicy, useDeletePolicy, useTogglePolicy } from '../api/hooks';
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
import { ProcessPolicyList } from '../components/policies/ProcessPolicyList';
import { SimulatePanel } from '../components/policies/SimulatePanel';
import { PolicyTierSection } from '../components/policies/PolicyTierSection';
import { useSnapshot } from 'valtio';
import { scopeStore } from '../state/scope';

const ALL_TAB_SLUGS = ['commands', 'network', 'filesystem', 'process', 'simulate'] as const;
const TOP_LEVEL_TAB_SLUGS = ['commands', 'network', 'filesystem', 'process'] as const;
const TAB_TARGETS: Record<string, 'command' | 'url' | 'filesystem' | 'process'> = {
  commands: 'command',
  network: 'url',
  filesystem: 'filesystem',
  process: 'process',
};

interface PoliciesProps {
  embedded?: boolean;
  embeddedTab?: string;
  onTabChange?: (tab: string) => void;
}

/** Filter policies by target type */
function filterByTarget(policies: PolicyConfig[], target: string) {
  return policies.filter((p) => p.target === target);
}

export function Policies({ embedded, embeddedTab, onTabChange }: PoliciesProps = {}) {
  const { tab } = useParams<{ tab: string }>();
  const navigate = useNavigate();

  const { profileId } = useSnapshot(scopeStore);

  // Simulate tab only available in target (scoped) context
  const isScoped = !!profileId;
  const tabSlugs = isScoped ? ALL_TAB_SLUGS : TOP_LEVEL_TAB_SLUGS;

  const resolvedTab = embedded ? embeddedTab : tab;
  const activeTab = Math.max(0, (tabSlugs as readonly string[]).indexOf(resolvedTab as string));
  const activeTarget = TAB_TARGETS[tabSlugs[activeTab]];

  const { data: config } = useConfig();
  const { data: tiered } = useTieredPolicies();
  const createPolicy = useCreatePolicy();
  const updatePolicy = useUpdatePolicy();
  const deletePolicy = useDeletePolicy();
  const togglePolicy = useTogglePolicy();
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

  // Flat policies from config — used only for fallback rendering while tiered data loads
  const policies = config?.data?.policies ?? [];
  const secrets = secretsData?.data ?? [];
  const skills = skillsData?.data ?? [];

  // Aggregate pending state for busy indicators
  const mutationPending = createPolicy.isPending || updatePolicy.isPending || deletePolicy.isPending || togglePolicy.isPending;

  // Tiered policies for rendering
  const managedPolicies = tiered?.managed ?? [];
  const globalPolicies = tiered?.global ?? [];
  const targetPolicies = tiered?.target ?? [];
  const targetSections = tiered?.targetSections ?? [];

  // The editable tier: in target view = target policies, in global view = global policies
  const editablePolicies = isScoped ? targetPolicies : globalPolicies;

  // Check if any installed skills have commands (for empty state)
  const hasSkillCommands = useMemo(
    () => skills.some((s) => s.status === 'active' && (s as any).analysis?.commands?.length),
    [skills],
  );

  const confirmToggle = (id: string, enabled: boolean) => {
    togglePolicy.mutate({ id, enabled });
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
      deletePolicy.mutate(deleteTarget, {
        onSuccess: () => setDeleteTarget(null),
      });
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
    const isUpdate = !!editingPolicy;
    const { id: _id, ...policyData } = newPolicy;
    const mutation = isUpdate
      ? updatePolicy.mutateAsync({ id: editingPolicy!.id, ...policyData })
      : createPolicy.mutateAsync(newPolicy);

    mutation
      .then(() => {
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
      })
      .catch((error) => {
        console.error('[policies] Failed to save policy:', error.message);
      });
  };

  // Filesystem inline handlers
  const handleFsUpdate = (policy: PolicyConfig) => {
    guard(() => {
      const { id, ...rest } = policy;
      updatePolicy.mutate({ id, ...rest });
    }, { description: 'Unlock to modify this filesystem policy.', actionLabel: 'Modify Policy' });
  };

  const handleFsAdd = (policy: PolicyConfig) => {
    guard(() => {
      createPolicy.mutate(policy);
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
    if (embedded && onTabChange) {
      onTabChange(tabSlugs[newTab]);
    } else {
      navigate(tabSlugs[newTab], { replace: true });
    }
    // Close editor when switching tabs (if not dirty)
    if (formOpen && !formDirty) {
      handleCancel();
    }
  };

  // Noop handlers for read-only sections
  const noop = () => {};
  const noopToggle = () => {};
  const noopEdit = () => {};
  const noopDelete = () => {};
  const noopAddSkill = () => {};

  /** Render a tier's policies for the currently active tab */
  function renderTierPolicies(
    tierPolicies: PolicyConfig[],
    readOnly: boolean,
  ) {
    const target = activeTarget;
    if (!target) return null;

    const filtered = filterByTarget(tierPolicies, target);

    if (filtered.length === 0) return (
      <Box sx={{ p: 2 }}>
        <Typography variant="body2" color="text.secondary">No policies</Typography>
      </Box>
    );

    if (activeTab === 0) {
      return (
        <CommandPolicyList
          policies={filtered}
          skills={readOnly ? [] : skills}
          onToggle={readOnly ? noopToggle : requestToggle}
          onEdit={readOnly ? noopEdit : handleEdit}
          onDelete={readOnly ? noopDelete : handleDelete}
          onAddSkillPolicy={readOnly ? noopAddSkill : handleAddSkillPolicy}
          readOnly={readOnly}
          busy={mutationPending}
        />
      );
    }

    if (activeTab === 1) {
      return (
        <NetworkPolicyList
          policies={filtered}
          onToggle={readOnly ? noopToggle : requestToggle}
          onEdit={readOnly ? noopEdit : handleEdit}
          onDelete={readOnly ? noopDelete : handleDelete}
          readOnly={readOnly}
          busy={mutationPending}
        />
      );
    }

    if (activeTab === 2) {
      return (
        <FilesystemPolicyTable
          policies={filtered}
          onToggle={readOnly ? noopToggle : requestToggle}
          onUpdate={readOnly ? noop : handleFsUpdate}
          onAdd={readOnly ? noop : handleFsAdd}
          onDelete={readOnly ? noopDelete : handleDelete}
          readOnly={readOnly}
          busy={mutationPending}
        />
      );
    }

    if (activeTab === 3) {
      return (
        <ProcessPolicyList
          policies={filtered}
          onToggle={readOnly ? noopToggle : requestToggle}
          onEdit={readOnly ? noopEdit : handleEdit}
          onDelete={readOnly ? noopDelete : handleDelete}
          readOnly={readOnly}
          busy={mutationPending}
        />
      );
    }

    return null;
  }

  /** Check if any tier has policies for the active tab target */
  const activePolicyTarget = activeTarget;
  const hasManagedForTab = activePolicyTarget ? filterByTarget(managedPolicies, activePolicyTarget).length > 0 : false;
  const hasGlobalForTab = activePolicyTarget ? filterByTarget(globalPolicies, activePolicyTarget).length > 0 : false;
  const hasTargetForTab = activePolicyTarget ? filterByTarget(targetPolicies, activePolicyTarget).length > 0 : false;
  const hasEditableForTab = activePolicyTarget ? filterByTarget(editablePolicies, activePolicyTarget).length > 0 : false;
  const hasAnyPolicies = hasManagedForTab || hasGlobalForTab || hasTargetForTab;

  return (
    <Box sx={embedded ? {} : { maxWidth: tokens.page.maxWidth, mx: 'auto' }}>
      {!embedded && (
        <PageHeader
          title="Policies"
          description="Manage security policies for command, URL, filesystem, and process filtering."
        />
      )}

      {/* Collapsible editor for Commands + Network tabs */}
      {activeTab <= 1 && (
        <Collapse in={formOpen} unmountOnExit timeout={250}>
          <Box sx={{ mb: 3, position: 'relative', zIndex: 10 }}>
            <PolicyEditor
              policy={editingPolicy}
              defaultTarget={editingPolicy ? editingPolicy.target : activeTarget}
              onSave={handleSave}
              onCancel={handleCancel}
              onDirtyChange={setFormDirty}
              onFocusChange={setFormFocused}
              error={createPolicy.isError || updatePolicy.isError}
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
            <Tab
              icon={<Cpu size={14} />}
              iconPosition="start"
              label="Process"
              sx={{ minHeight: 48, textTransform: 'none' }}
            />
            {isScoped && (
              <Tab
                icon={<Play size={14} />}
                iconPosition="start"
                label="Simulate"
                sx={{ minHeight: 48, textTransform: 'none' }}
              />
            )}
          </Tabs>

          {/* Add button — only for Commands and Network tabs */}
          {!formOpen && activeTab <= 1 && (
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
          {/* Tab 4: Simulate — no tiering needed */}
          {activeTab === 4 && <SimulatePanel />}

          {/* Tabs 0-3: Tiered policy display */}
          {activeTab <= 3 && !tiered && (
            /* Fallback to flat list while tiered data is loading */
            <>
              {activeTab === 0 && (
                filterByTarget(policies, 'command').length === 0 && !hasSkillCommands ? (
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
                    policies={filterByTarget(policies, 'command')}
                    skills={skills}
                    onToggle={requestToggle}
                    onEdit={handleEdit}
                    onDelete={handleDelete}
                    onAddSkillPolicy={handleAddSkillPolicy}
                    readOnly={false}
                    busy={mutationPending}
                  />
                )
              )}

              {activeTab === 1 && (
                filterByTarget(policies, 'url').length === 0 ? (
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
                    policies={filterByTarget(policies, 'url')}
                    onToggle={requestToggle}
                    onEdit={handleEdit}
                    onDelete={handleDelete}
                    readOnly={false}
                    busy={mutationPending}
                  />
                )
              )}

              {activeTab === 2 && (
                <FilesystemPolicyTable
                  policies={filterByTarget(policies, 'filesystem')}
                  onToggle={requestToggle}
                  onUpdate={handleFsUpdate}
                  onAdd={handleFsAdd}
                  onDelete={handleDelete}
                  readOnly={false}
                  busy={mutationPending}
                />
              )}

              {activeTab === 3 && (
                filterByTarget(policies, 'process').length === 0 ? (
                  <EmptyState
                    icon={<Cpu size={28} />}
                    title="No process policies"
                    description="Process policies are managed by your organization's admin from AgenShield Cloud."
                  />
                ) : (
                  <ProcessPolicyList
                    policies={filterByTarget(policies, 'process')}
                    onToggle={requestToggle}
                    onEdit={handleEdit}
                    onDelete={handleDelete}
                    readOnly={false}
                    busy={mutationPending}
                  />
                )
              )}
            </>
          )}

          {activeTab <= 3 && tiered && (
            <Box sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 2 }}>
              {/* Empty state when no policies exist for this tab */}
              {!hasAnyPolicies && activeTab === 0 && !hasSkillCommands && (
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
              )}
              {!hasAnyPolicies && activeTab === 1 && (
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
              )}
              {!hasAnyPolicies && activeTab === 3 && (
                <EmptyState
                  icon={<Cpu size={28} />}
                  title="No process policies"
                  description="Process policies are managed by your organization's admin from AgenShield Cloud."
                />
              )}

              {/* Managed tier — always read-only */}
              {hasManagedForTab && (
                <PolicyTierSection
                  tier="managed"
                  label="Managed Policies"
                  description="Admin-enforced policies that cannot be modified"
                  count={activePolicyTarget ? filterByTarget(managedPolicies, activePolicyTarget).length : 0}
                  readOnly
                >
                  {renderTierPolicies(managedPolicies, true)}
                </PolicyTierSection>
              )}

              {/* Global tier — editable in global view, read-only in target view */}
              {hasGlobalForTab && (
                <PolicyTierSection
                  tier="global"
                  label={isScoped ? 'Inherited (Global)' : 'Global Policies'}
                  count={activePolicyTarget ? filterByTarget(globalPolicies, activePolicyTarget).length : 0}
                  readOnly={isScoped}
                >
                  {renderTierPolicies(globalPolicies, isScoped)}
                </PolicyTierSection>
              )}

              {/* Target tier — only in scoped context */}
              {isScoped && (
                <PolicyTierSection
                  tier="target"
                  label="Target Policies"
                  count={activePolicyTarget ? filterByTarget(targetPolicies, activePolicyTarget).length : 0}
                >
                  {hasTargetForTab ? (
                    renderTierPolicies(targetPolicies, false)
                  ) : (
                    <Box sx={{ p: 2 }}>
                      <Typography variant="body2" color="text.secondary">
                        No target-specific policies for this tab.
                      </Typography>
                    </Box>
                  )}
                </PolicyTierSection>
              )}

              {/* Target sections — only in global view */}
              {!isScoped && targetSections.length > 0 && targetSections.map((section) => {
                const sectionFiltered = activePolicyTarget
                  ? filterByTarget(section.policies, activePolicyTarget)
                  : [];
                if (sectionFiltered.length === 0) return null;
                return (
                  <PolicyTierSection
                    key={section.profileId}
                    tier="target"
                    label={section.targetName}
                    count={sectionFiltered.length}
                    collapsible
                    defaultCollapsed
                    readOnly
                  >
                    {renderTierPolicies(section.policies, true)}
                  </PolicyTierSection>
                );
              })}

              {/* Filesystem always shows the add row in the editable tier */}
              {activeTab === 2 && !hasEditableForTab && (
                <FilesystemPolicyTable
                  policies={[]}
                  onToggle={requestToggle}
                  onUpdate={handleFsUpdate}
                  onAdd={handleFsAdd}
                  onDelete={handleDelete}
                  readOnly={false}
                  busy={mutationPending}
                />
              )}
            </Box>
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
