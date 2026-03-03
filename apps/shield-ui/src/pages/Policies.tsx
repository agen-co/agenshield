/**
 * Policies page — thin router with overview + drill-down views
 *
 * No tab → PolicyOverview (grouped summary of all policy types)
 * tab === 'commands' | 'network' | 'filesystem' | 'process' → drill-down
 * tab === 'simulate' → SimulatePanel (only when scoped)
 * tab === 'graph' → PolicyGraphView
 *
 * Policies are organized into three tiers:
 * - Managed: Admin-enforced, read-only
 * - Global: Shared across targets (read-only in target view)
 * - Target: Per-target policies (only in scoped context)
 */

import { useState, useCallback, useMemo, lazy, Suspense } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Box,
  Button,
  Card,
  CardContent,
  Collapse,
  Typography,
} from '@mui/material';
import { Plus, Terminal, Globe, FolderOpen, Cpu, ArrowLeft } from 'lucide-react';
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
import { WorkspacePathsList } from '../components/policies/WorkspacePathsList';
import { CircularLoader } from '../elements';
import { useSnapshot } from 'valtio';
import { scopeStore } from '../state/scope';

const LazyPolicyOverview = lazy(() => import('../components/policies/PolicyOverview').then(m => ({ default: m.PolicyOverview })));
const LazyPolicyGraphView = lazy(() => import('../components/policies/PolicyGraphView').then(m => ({ default: m.PolicyGraphView })));

const TAB_TARGETS: Record<string, 'command' | 'url' | 'filesystem' | 'process'> = {
  commands: 'command',
  network: 'url',
  filesystem: 'filesystem',
  process: 'process',
};

const TAB_META: Record<string, { label: string; icon: typeof Terminal; target: string }> = {
  commands: { label: 'Commands', icon: Terminal, target: 'command' },
  network: { label: 'Network', icon: Globe, target: 'url' },
  filesystem: { label: 'Filesystem', icon: FolderOpen, target: 'filesystem' },
  process: { label: 'Process', icon: Cpu, target: 'process' },
};

interface PoliciesProps {
  embedded?: boolean;
  embeddedTab?: string;
  onPoliciesNavigate?: (key: string) => void;
}

/** Filter policies by target type */
function filterByTarget(policies: PolicyConfig[], target: string) {
  return policies.filter((p) => p.target === target);
}

export function Policies({ embedded, embeddedTab, onPoliciesNavigate }: PoliciesProps = {}) {
  const { tab } = useParams<{ tab: string }>();
  const navigate = useNavigate();

  const { profileId } = useSnapshot(scopeStore);
  const isScoped = !!profileId;

  const resolvedTab = embedded ? embeddedTab : tab;

  // Route to the right view
  if (!resolvedTab) {
    return (
      <Box sx={embedded ? {} : { maxWidth: tokens.page.maxWidth, mx: 'auto' }}>
        {!embedded && (
          <PageHeader
            title="Policies"
            description="Manage security policies for all target types."
          />
        )}
        <Suspense fallback={<Box sx={{ display: 'flex', justifyContent: 'center', p: 5 }}><CircularLoader /></Box>}>
          <LazyPolicyOverview embedded={embedded} onNavigate={onPoliciesNavigate} />
        </Suspense>
      </Box>
    );
  }

  if (resolvedTab === 'graph') {
    return (
      <Box sx={embedded ? {} : { maxWidth: tokens.page.maxWidth, mx: 'auto' }}>
        <Suspense fallback={<Box sx={{ display: 'flex', justifyContent: 'center', p: 5 }}><CircularLoader /></Box>}>
          <LazyPolicyGraphView onBack={() => navigate(-1)} />
        </Suspense>
      </Box>
    );
  }

  if (resolvedTab === 'simulate' && isScoped) {
    return (
      <Box sx={embedded ? {} : { maxWidth: tokens.page.maxWidth, mx: 'auto' }}>
        <DrilldownHeader
          label="Simulate"
          embedded={embedded}
          onBack={() => navigate(-1)}
        />
        <SimulatePanel />
      </Box>
    );
  }

  // Drill-down view for commands/network/filesystem/process
  const activeTarget = TAB_TARGETS[resolvedTab];
  if (!activeTarget) {
    // Unknown tab → redirect to overview
    return (
      <Box sx={embedded ? {} : { maxWidth: tokens.page.maxWidth, mx: 'auto' }}>
        <Suspense fallback={<Box sx={{ display: 'flex', justifyContent: 'center', p: 5 }}><CircularLoader /></Box>}>
          <LazyPolicyOverview embedded={embedded} onNavigate={onPoliciesNavigate} />
        </Suspense>
      </Box>
    );
  }

  return (
    <PolicyDrilldown
      tab={resolvedTab}
      target={activeTarget}
      embedded={embedded}
    />
  );
}

/* ---- Drill-down header with back navigation ---- */

function DrilldownHeader({ label, embedded, onBack }: { label: string; embedded?: boolean; onBack: () => void }) {
  if (embedded) return null;
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
      <Button
        size="small"
        variant="text"
        startIcon={<ArrowLeft size={14} />}
        onClick={onBack}
        sx={{ textTransform: 'none', color: 'text.secondary' }}
      >
        All Policies
      </Button>
      <Typography variant="h6" sx={{ fontWeight: 700 }}>{label}</Typography>
    </Box>
  );
}

/* ---- Policy drill-down view ---- */

interface PolicyDrilldownProps {
  tab: string;
  target: 'command' | 'url' | 'filesystem' | 'process';
  embedded?: boolean;
}

function PolicyDrilldown({ tab, target, embedded }: PolicyDrilldownProps) {
  const navigate = useNavigate();
  const { profileId } = useSnapshot(scopeStore);
  const isScoped = !!profileId;

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

  const policies = config?.data?.policies ?? [];
  const secrets = secretsData?.data ?? [];
  const skills = skillsData?.data ?? [];
  const mutationPending = createPolicy.isPending || updatePolicy.isPending || deletePolicy.isPending || togglePolicy.isPending;

  const managedPolicies = tiered?.managed ?? [];
  const globalPolicies = tiered?.global ?? [];
  const targetPolicies = tiered?.target ?? [];
  const targetSections = tiered?.targetSections ?? [];
  const editablePolicies = isScoped ? targetPolicies : globalPolicies;

  const hasSkillCommands = useMemo(
    () => skills.some((s) => s.status === 'active' && (s as any).analysis?.commands?.length),
    [skills],
  );

  const meta = TAB_META[tab];

  // CRUD handlers
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

  // Noop handlers for read-only sections
  const noop = () => {};
  const noopToggle = () => {};
  const noopEdit = () => {};
  const noopDelete = () => {};
  const noopAddSkill = () => {};

  /** Render a tier's policies for the current target */
  function renderTierPolicies(tierPolicies: PolicyConfig[], readOnly: boolean) {
    const filtered = filterByTarget(tierPolicies, target);

    if (filtered.length === 0) return (
      <Box sx={{ p: 2 }}>
        <Typography variant="body2" color="text.secondary">No policies</Typography>
      </Box>
    );

    if (target === 'command') {
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

    if (target === 'url') {
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

    if (target === 'filesystem') {
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

    if (target === 'process') {
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

  const hasManagedForTab = filterByTarget(managedPolicies, target).length > 0;
  const hasGlobalForTab = filterByTarget(globalPolicies, target).length > 0;
  const hasTargetForTab = filterByTarget(targetPolicies, target).length > 0;
  const hasEditableForTab = filterByTarget(editablePolicies, target).length > 0;
  const hasAnyPolicies = hasManagedForTab || hasGlobalForTab || hasTargetForTab;

  // Show editor for command and network types
  const showEditor = target === 'command' || target === 'url';

  return (
    <Box sx={embedded ? {} : { maxWidth: tokens.page.maxWidth, mx: 'auto' }}>
      <DrilldownHeader
        label={meta?.label ?? tab}
        embedded={embedded}
        onBack={() => navigate(-1)}
      />

      {/* Collapsible editor for Commands + Network tabs */}
      {showEditor && (
        <Collapse in={formOpen} unmountOnExit timeout={250}>
          <Box sx={{ mb: 3, position: 'relative', zIndex: 10 }}>
            <PolicyEditor
              policy={editingPolicy}
              defaultTarget={editingPolicy ? editingPolicy.target : target}
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
        {/* Add button header */}
        {showEditor && !formOpen && (
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', borderBottom: 1, borderColor: 'divider', px: 2, py: 1 }}>
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

        <CardContent sx={{ p: 0, '&:last-child': { pb: 0 } }}>
          {/* Loading fallback */}
          {!tiered && (
            <>
              {target === 'command' && (
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

              {target === 'url' && (
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

              {target === 'filesystem' && (
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

              {target === 'process' && (
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

          {/* Tiered display */}
          {tiered && (
            <Box sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 2 }}>
              {/* Empty state */}
              {!hasAnyPolicies && target === 'command' && !hasSkillCommands && (
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
              {!hasAnyPolicies && target === 'url' && (
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
              {!hasAnyPolicies && target === 'process' && (
                <EmptyState
                  icon={<Cpu size={28} />}
                  title="No process policies"
                  description="Process policies are managed by your organization's admin from AgenShield Cloud."
                />
              )}

              {/* Managed tier */}
              {hasManagedForTab && (
                <PolicyTierSection
                  tier="managed"
                  label="Managed Policies"
                  description="Admin-enforced policies that cannot be modified"
                  count={filterByTarget(managedPolicies, target).length}
                  readOnly
                >
                  {renderTierPolicies(managedPolicies, true)}
                </PolicyTierSection>
              )}

              {/* Global tier */}
              {hasGlobalForTab && (
                <PolicyTierSection
                  tier="global"
                  label={isScoped ? 'Inherited (Global)' : 'Global Policies'}
                  count={filterByTarget(globalPolicies, target).length}
                  readOnly={isScoped}
                >
                  {renderTierPolicies(globalPolicies, isScoped)}
                </PolicyTierSection>
              )}

              {/* Target tier */}
              {isScoped && (
                <PolicyTierSection
                  tier="target"
                  label="Target Policies"
                  count={filterByTarget(targetPolicies, target).length}
                >
                  {hasTargetForTab ? (
                    renderTierPolicies(targetPolicies, false)
                  ) : (
                    <Box sx={{ p: 2 }}>
                      <Typography variant="body2" color="text.secondary">
                        No target-specific policies for this type.
                      </Typography>
                    </Box>
                  )}
                </PolicyTierSection>
              )}

              {/* Target sections — only in global view */}
              {!isScoped && targetSections.length > 0 && targetSections.map((section) => {
                const sectionFiltered = filterByTarget(section.policies, target);
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

              {/* Filesystem add row */}
              {target === 'filesystem' && !hasEditableForTab && (
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

      {/* Workspace paths section — filesystem drill-down only */}
      {target === 'filesystem' && (
        <Card sx={{ mt: 3, p: 0 }}>
          <Box sx={{ px: 2, py: 1.5, borderBottom: 1, borderColor: 'divider' }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
              Workspace Paths
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Directories the agent is allowed to access outside its home folder.
            </Typography>
          </Box>
          <WorkspacePathsList />
        </Card>
      )}

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
