/**
 * Skills page - unified skill management, search, and analysis
 *
 * Supports two modes:
 *  1. Global (default): full search, marketplace, drag-and-drop upload, InstallTargetDialog
 *  2. Target-scoped (`targetId` prop): shows "Installed on this target" + "Available to install"
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { Box, Skeleton, Typography, Tabs, Tab, Badge } from '@mui/material';
import Grid from '@mui/material/Grid2';
import { useSnapshot } from 'valtio';
import { tokens } from '../styles/tokens';
import { PageHeader } from '../components/shared/PageHeader';
import { SearchInput } from '../components/shared/SearchInput';
import { SkillsEmptyState } from '../components/skills/SkillsEmptyState';
import { UnifiedSkillCard } from '../components/skills/UnifiedSkillCard';
import { SkillDropZone } from '../components/skills/SkillDropZone';
import { InstallTargetDialog } from '../components/skills/InstallTargetDialog';
import { X } from 'lucide-react';
import {
  skillsStore,
  fetchInstalledSkills,
  searchSkills,
  clearSearch,
  analyzeSkill,
  downloadSkill,
  installSkill,
  uninstallSkill,
  unblockSkill,
  uploadSkillZip,
  getTrustedSkills,
  getUntrustedSkills,
  reinstallUntrustedSkill,
  deleteUntrustedSkill,
  type UnifiedSkill,
} from '../stores/skills';
import { ConfirmDialog } from '../components/shared/ConfirmDialog';
import { UntrustedSkillsSection } from '../components/skills/UntrustedSkillsSection';
import { useGuardedAction } from '../hooks/useGuardedAction';
import { WorkspaceSkillsPanel } from '../components/workspace-skills/WorkspaceSkillsPanel';
import { useWorkspaceSkillsPendingCount } from '../api/hooks';
import { useAuth } from '../context/AuthContext';

interface SkillsProps {
  embedded?: boolean;
  /** When set, the page operates in target-scoped mode */
  targetId?: string;
  /** When provided, called instead of navigate on card click */
  onSkillClick?: (skillId: string) => void;
}

export function Skills({ embedded, targetId, onSkillClick }: SkillsProps = {}) {
  const snap = useSnapshot(skillsStore);
  const guard = useGuardedAction();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const auth = useAuth();

  const [activeTab, setActiveTab] = useState(0);
  const { data: pendingCountData } = useWorkspaceSkillsPendingCount();
  const pendingCount = pendingCountData?.data?.count ?? 0;

  const [confirmUninstall, setConfirmUninstall] = useState<{ name: string } | null>(null);
  const [installDialog, setInstallDialog] = useState<{ name: string; slug: string; installations?: UnifiedSkill['installations'] } | null>(null);

  // Read search from URL
  const qParam = searchParams.get('q') ?? '';

  // Local search state for responsive input
  const [search, setSearch] = useState(qParam);

  // Debounced search value (300ms)
  const [debouncedSearch, setDebouncedSearch] = useState(qParam);
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(timer);
  }, [search]);

  // Sync debounced value to URL (only in global mode)
  useEffect(() => {
    if (targetId) return; // target-scoped mode uses local filtering only
    const next = new URLSearchParams(searchParams);
    if (debouncedSearch) {
      next.set('q', debouncedSearch);
    } else {
      next.delete('q');
    }
    if (next.toString() !== searchParams.toString()) {
      setSearchParams(next, { replace: true });
    }
  }, [debouncedSearch, searchParams, setSearchParams, targetId]);

  // Fetch installed skills on mount
  useEffect(() => {
    fetchInstalledSkills();
  }, []);

  // Search when debounced value changes (global mode only — marketplace search)
  useEffect(() => {
    if (!targetId) {
      searchSkills(debouncedSearch);
    }
  }, [debouncedSearch, targetId]);

  const handleCardClick = useCallback(
    (id: string) => {
      if (onSkillClick) {
        onSkillClick(id);
      } else {
        navigate(`/skills/${id}`);
      }
    },
    [navigate, onSkillClick],
  );

  // ---- Target-scoped skill partitioning ----

  const isTargetMode = !!targetId;

  // In target-scoped mode, split skills into "installed on this target" and "available"
  const { installedOnTarget, availableForTarget } = useMemo(() => {
    if (!isTargetMode) return { installedOnTarget: [] as UnifiedSkill[], availableForTarget: [] as UnifiedSkill[] };

    const installed: UnifiedSkill[] = [];
    const available: UnifiedSkill[] = [];
    const q = debouncedSearch.toLowerCase();

    for (const skill of snap.skills as UnifiedSkill[]) {
      // Skip untrusted / search-only skills in target view
      if (skill.origin === 'untrusted' || skill.origin === 'search') continue;

      // Client-side filter
      if (q.length >= 2) {
        const matches = skill.name.toLowerCase().includes(q)
          || skill.slug.toLowerCase().includes(q)
          || skill.description.toLowerCase().includes(q);
        if (!matches) continue;
      }

      const isOnTarget = skill.installations?.some(
        i => i.profileId === targetId && i.status === 'active',
      ) ?? false;

      if (isOnTarget) {
        installed.push(skill);
      } else if (skill.origin === 'installed' || skill.origin === 'downloaded') {
        available.push(skill);
      }
    }

    return { installedOnTarget: installed, availableForTarget: available };
  }, [isTargetMode, snap.skills, targetId, debouncedSearch]);

  // ---- Global mode skill lists ----

  const isSearching = debouncedSearch.length >= 2;
  const trustedSkills = isTargetMode ? [] : (isSearching ? snap.skills : getTrustedSkills(snap.skills));
  const untrustedSkills = isTargetMode ? [] : (isSearching ? [] : getUntrustedSkills(snap.skills));

  const getSkillActionLabel = (skill: { actionState: string; origin: string }) => {
    if (skill.origin === 'untrusted' && skill.actionState === 'analyzed') return 'Reinstall';
    switch (skill.actionState) {
      case 'not_analyzed': case 'analysis_failed': return 'Analyze';
      case 'analyzed':
        return skill.origin === 'downloaded' ? 'Install' : 'Download';
      case 'installed': return 'Uninstall';
      case 'blocked': return 'Unblock';
      default: return 'Manage';
    }
  };

  const handleAction = useCallback(
    (skill: (typeof snap.skills)[number]) => {
      const label = isTargetMode
        ? (skill.installations?.some(i => i.profileId === targetId && i.status === 'active') ? 'Uninstall' : 'Install')
        : getSkillActionLabel(skill);

      guard(async () => {
        // ---- Target-scoped actions ----
        if (isTargetMode) {
          const isOnTarget = skill.installations?.some(
            i => i.profileId === targetId && i.status === 'active',
          ) ?? false;

          if (isOnTarget) {
            setConfirmUninstall({ name: skill.name });
          } else {
            await installSkill(skill.slug, targetId);
          }
          return;
        }

        // ---- Global mode actions ----
        if (skill.origin === 'untrusted' && skill.actionState === 'analyzed') {
          await reinstallUntrustedSkill(skill.name);
          return;
        }
        switch (skill.actionState) {
          case 'not_analyzed':
          case 'analysis_failed':
            await analyzeSkill(skill.slug);
            break;
          case 'analyzed':
            // Downloaded skills → open target dialog; search results → download first
            if (skill.origin === 'downloaded') {
              setInstallDialog({
                name: skill.name,
                slug: skill.slug,
                installations: skill.installations as UnifiedSkill['installations'],
              });
              return; // Dialog handles it
            } else {
              await downloadSkill(skill.slug);
            }
            break;
          case 'installed':
            // If skill has installations, open target dialog for per-target management
            if (skill.installations && skill.installations.length > 0) {
              setInstallDialog({
                name: skill.name,
                slug: skill.slug,
                installations: skill.installations as UnifiedSkill['installations'],
              });
              return;
            }
            setConfirmUninstall({ name: skill.name });
            return; // Don't run inside guard — dialog handles it

          case 'blocked':
            await analyzeSkill(skill.slug);
            await unblockSkill(skill.name);
            break;
        }
      }, { description: `Unlock to ${label.toLowerCase()} this skill.`, actionLabel: label });
    },
    [guard, isTargetMode, targetId],
  );

  const handleDelete = useCallback(
    (skill: (typeof snap.skills)[number]) => {
      guard(() => deleteUntrustedSkill(skill.name), {
        description: `Unlock to permanently delete "${skill.name}".`,
        actionLabel: 'Delete',
      });
    },
    [guard],
  );

  const handleZipDrop = useCallback((file: File) => {
    guard(() => uploadSkillZip(file), {
      description: 'Unlock to upload a skill package.',
      actionLabel: 'Upload Skill',
    });
  }, [guard]);

  const handleInstallToTarget = useCallback(async (targetId?: string) => {
    if (!installDialog) return;
    await installSkill(installDialog.slug, targetId ?? 'global');
    await fetchInstalledSkills();
    // Refresh installations in dialog state
    const updated = skillsStore.skills.find(s => s.slug === installDialog.slug);
    if (updated) {
      setInstallDialog(prev => prev ? { ...prev, installations: updated.installations as UnifiedSkill['installations'] } : null);
    }
  }, [installDialog]);

  const handleUninstallFromTarget = useCallback(async (targetId?: string) => {
    if (!installDialog) return;
    await uninstallSkill(installDialog.name, targetId);
    await fetchInstalledSkills();
    // Refresh installations in dialog state
    const updated = skillsStore.skills.find(s => s.slug === installDialog.slug);
    if (updated) {
      setInstallDialog(prev => prev ? { ...prev, installations: updated.installations as UnifiedSkill['installations'] } : null);
    }
  }, [installDialog]);

  // ---- Target-scoped rendering ----

  if (isTargetMode) {
    const hasAny = installedOnTarget.length > 0 || availableForTarget.length > 0;
    const showEmpty = !hasAny && !snap.installedLoading;

    return (
      <Box>
        <Box sx={{ mb: 3 }}>
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Filter skills..."
            loading={false}
          />
          {search.length > 0 && (
            <Typography
              variant="caption"
              component="button"
              onClick={() => setSearch('')}
              sx={{
                mt: 0.75,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 0.5,
                background: 'none',
                border: 'none',
                padding: 0,
                cursor: 'pointer',
                color: 'text.secondary',
                '&:hover': { color: 'text.primary' },
              }}
            >
              <X size={12} />
              Clear filter
            </Typography>
          )}
        </Box>

        {showEmpty ? (
          <SkillsEmptyState />
        ) : (
          <>
            {/* Installed on this target */}
            {installedOnTarget.length > 0 && (
              <>
                <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1.5 }}>
                  Installed on this target
                </Typography>
                <Grid container spacing={2} sx={{ mb: 3 }}>
                  {installedOnTarget.map((skill) => (
                    <Grid key={skill.slug} size={{ xs: 12, md: 6 }}>
                      <UnifiedSkillCard
                        skill={skill as Parameters<typeof UnifiedSkillCard>[0]['skill']}
                        targetProfileId={targetId}
                        onClick={() => handleCardClick(skill.installationId ?? skill.slug)}
                        onAction={() => handleAction(skill)}
                      />
                    </Grid>
                  ))}
                </Grid>
              </>
            )}

            {/* Available to install */}
            {availableForTarget.length > 0 && (
              <>
                <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1.5 }}>
                  Available to install
                </Typography>
                <Grid container spacing={2}>
                  {availableForTarget.map((skill) => (
                    <Grid key={skill.slug} size={{ xs: 12, md: 6 }}>
                      <UnifiedSkillCard
                        skill={skill as Parameters<typeof UnifiedSkillCard>[0]['skill']}
                        targetProfileId={targetId}
                        onClick={() => handleCardClick(skill.installationId ?? skill.slug)}
                        onAction={() => handleAction(skill)}
                      />
                    </Grid>
                  ))}
                </Grid>
              </>
            )}
          </>
        )}

        <ConfirmDialog
          open={!!confirmUninstall}
          title="Uninstall Skill"
          message={`Are you sure you want to uninstall "${confirmUninstall?.name}" from this target?`}
          confirmLabel="Uninstall"
          variant="danger"
          onConfirm={async () => {
            if (confirmUninstall) {
              await uninstallSkill(confirmUninstall.name, targetId);
            }
            setConfirmUninstall(null);
          }}
          onCancel={() => setConfirmUninstall(null)}
        />
      </Box>
    );
  }

  // ---- Global rendering ----

  const hasSkills = trustedSkills.length > 0 || untrustedSkills.length > 0;
  const showEmpty = !hasSkills && !snap.searchLoading && !snap.installedLoading;

  return (
    <Box sx={embedded ? {} : { maxWidth: tokens.page.maxWidth, mx: 'auto' }}>
      {!embedded && (
        <PageHeader
          title="Skills"
          description="Manage, discover, and analyze agent skills."
        />
      )}

      <Tabs
        value={activeTab}
        onChange={(_, v) => setActiveTab(v)}
        sx={{ mb: 3, borderBottom: 1, borderColor: 'divider' }}
      >
        <Tab label="Installed Skills" />
        <Tab
          label={
            <Badge badgeContent={pendingCount} color="warning" max={99}>
              <Box sx={{ pr: pendingCount > 0 ? 1.5 : 0 }}>Workspace Skills</Box>
            </Badge>
          }
        />
      </Tabs>

      {activeTab === 1 ? (
        <WorkspaceSkillsPanel isReadOnly={!auth.authenticated} />
      ) : (
      <>
      <Box sx={{ mb: 3 }}>
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Search skills..."
          loading={snap.searchLoading}
        />
        {search.length > 0 && (
          <Typography
            variant="caption"
            component="button"
            onClick={() => { setSearch(''); clearSearch(); }}
            sx={{
              mt: 0.75,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 0.5,
              background: 'none',
              border: 'none',
              padding: 0,
              cursor: 'pointer',
              color: 'text.secondary',
              '&:hover': { color: 'text.primary' },
            }}
          >
            <X size={12} />
            Clear search
          </Typography>
        )}
      </Box>

      <SkillDropZone onDrop={handleZipDrop}>
        {showEmpty ? (
          <SkillsEmptyState />
        ) : (
          <>
            <Grid
              container
              spacing={2}
              sx={{
                opacity: snap.searchLoading ? 0.45 : 1,
                pointerEvents: snap.searchLoading ? 'none' : 'auto',
                transition: 'opacity 200ms',
              }}
            >
              {snap.searchLoading && !hasSkills
                ? Array.from({ length: 4 }).map((_, i) => (
                    <Grid key={i} size={{ xs: 12, md: 6 }}>
                      <Skeleton
                        variant="rectangular"
                        height={160}
                        sx={{ borderRadius: 2 }}
                      />
                    </Grid>
                  ))
                : trustedSkills.map((skill) => (
                    <Grid key={skill.slug} size={{ xs: 12, md: 6 }}>
                      <UnifiedSkillCard
                        skill={skill as Parameters<typeof UnifiedSkillCard>[0]['skill']}
                        onClick={() => handleCardClick(skill.installationId ?? skill.slug)}
                        onAction={() => handleAction(skill)}
                      />
                    </Grid>
                  ))}
            </Grid>

            {!isSearching && (
              <UntrustedSkillsSection
                skills={untrustedSkills}
                onCardClick={handleCardClick}
                onAction={(skill) => handleAction(skill as (typeof snap.skills)[number])}
                onDelete={(skill) => handleDelete(skill as (typeof snap.skills)[number])}
              />
            )}
          </>
        )}
      </SkillDropZone>

      <ConfirmDialog
        open={!!confirmUninstall}
        title="Uninstall Skill"
        message={`Are you sure you want to uninstall "${confirmUninstall?.name}"? This will remove the skill and its deployed files.`}
        confirmLabel="Uninstall"
        variant="danger"
        onConfirm={async () => {
          if (confirmUninstall) {
            await uninstallSkill(confirmUninstall.name);
          }
          setConfirmUninstall(null);
        }}
        onCancel={() => setConfirmUninstall(null)}
      />

      <InstallTargetDialog
        open={!!installDialog}
        skillName={installDialog?.name ?? ''}
        skillSlug={installDialog?.slug ?? ''}
        existingInstallations={installDialog?.installations}
        onInstallToTarget={handleInstallToTarget}
        onUninstallFromTarget={handleUninstallFromTarget}
        onClose={() => setInstallDialog(null)}
      />
      </>
      )}
    </Box>
  );
}
