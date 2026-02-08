/**
 * Skills page - unified skill management, search, and analysis
 */

import { useState, useEffect, useCallback } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { Box, Skeleton, Typography } from '@mui/material';
import Grid from '@mui/material/Grid2';
import { useSnapshot } from 'valtio';
import { tokens } from '../styles/tokens';
import { PageHeader } from '../components/shared/PageHeader';
import { SearchInput } from '../components/shared/SearchInput';
import { SkillsEmptyState } from '../components/skills/SkillsEmptyState';
import { UnifiedSkillCard } from '../components/skills/UnifiedSkillCard';
import { SkillDropZone } from '../components/skills/SkillDropZone';
import { X } from 'lucide-react';
import {
  skillsStore,
  fetchInstalledSkills,
  searchSkills,
  clearSearch,
  analyzeSkill,
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
import { UntrustedSkillsSection } from '../components/skills/UntrustedSkillsSection';
import { useGuardedAction } from '../hooks/useGuardedAction';

export function Skills() {
  const snap = useSnapshot(skillsStore);
  const guard = useGuardedAction();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

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

  // Sync debounced value to URL
  useEffect(() => {
    const next = new URLSearchParams(searchParams);
    if (debouncedSearch) {
      next.set('q', debouncedSearch);
    } else {
      next.delete('q');
    }
    if (next.toString() !== searchParams.toString()) {
      setSearchParams(next, { replace: true });
    }
  }, [debouncedSearch, searchParams, setSearchParams]);

  // Fetch installed skills on mount
  useEffect(() => {
    fetchInstalledSkills();
  }, []);

  // Search when debounced value changes
  useEffect(() => {
    searchSkills(debouncedSearch);
  }, [debouncedSearch]);

  const handleCardClick = useCallback(
    (slug: string) => {
      navigate(`/skills/${slug}`);
    },
    [navigate],
  );

  const isSearching = debouncedSearch.length >= 2;
  const trustedSkills = isSearching ? snap.skills : getTrustedSkills(snap.skills);
  const untrustedSkills = isSearching ? [] : getUntrustedSkills(snap.skills);

  const getSkillActionLabel = (skill: { actionState: string; origin: string }) => {
    if (skill.origin === 'untrusted' && skill.actionState === 'analyzed') return 'Reinstall';
    switch (skill.actionState) {
      case 'not_analyzed': case 'analysis_failed': return 'Analyze';
      case 'analyzed': return 'Install';
      case 'installed': return 'Uninstall';
      case 'blocked': return 'Unblock';
      default: return 'Manage';
    }
  };

  const handleAction = useCallback(
    (skill: (typeof snap.skills)[number]) => {
      const label = getSkillActionLabel(skill);
      guard(async () => {
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
            await installSkill(skill.slug);
            break;
          case 'installed':
            await uninstallSkill(skill.name);
            break;
          case 'blocked':
            await analyzeSkill(skill.slug);
            await unblockSkill(skill.name);
            break;
        }
      }, { description: `Unlock to ${label.toLowerCase()} this skill.`, actionLabel: label });
    },
    [guard],
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

  const hasSkills = trustedSkills.length > 0 || untrustedSkills.length > 0;
  const showEmpty = !hasSkills && !snap.searchLoading && !snap.installedLoading;

  return (
    <Box sx={{ maxWidth: tokens.page.maxWidth, mx: 'auto' }}>
      <PageHeader
        title="Skills"
        description="Manage, discover, and analyze agent skills."
      />

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
                        onClick={() => handleCardClick(skill.slug)}
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
    </Box>
  );
}
