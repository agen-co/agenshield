/**
 * Skills page - skill scanning and management
 */

import { useState, useEffect, useMemo } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import {
  Box,
  Card,
  CardContent,
  Tabs,
  Tab,
  Skeleton,
} from '@mui/material';
import { Zap } from 'lucide-react';
import { useSkills } from '../api/hooks';
import type { SkillsTab } from '../api/marketplace.types';
import { tokens } from '../styles/tokens';
import { PageHeader } from '../components/shared/PageHeader';
import { SearchInput } from '../components/shared/SearchInput';
import { EmptyState } from '../components/shared/EmptyState';
import { SkillsList } from '../components/skills/SkillsList';
import { MarketplaceList } from '../components/skills/MarketplaceList';

const tabEmptyMessages: Record<Exclude<SkillsTab, 'marketplace'>, { title: string; description: string }> = {
  active: {
    title: 'No active skills',
    description: 'Activated skills will appear here.',
  },
  available: {
    title: 'No available skills',
    description: 'Downloaded and disabled skills will appear here.',
  },
  blocked: {
    title: 'No blocked skills',
    description: 'Quarantined skills will appear here.',
  },
};

const tabStatusFilters: Record<Exclude<SkillsTab, 'marketplace'>, (status: string) => boolean> = {
  active: (status) => status === 'active' || status === 'workspace',
  available: (status) => status === 'downloaded' || status === 'disabled',
  blocked: (status) => status === 'quarantined',
};

const validTabs: SkillsTab[] = ['active', 'available', 'blocked', 'marketplace'];

export function Skills() {
  const { data, isLoading } = useSkills();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  // Read tab & search from URL
  const tabParam = searchParams.get('tab') ?? 'active';
  const tab: SkillsTab = validTabs.includes(tabParam as SkillsTab) ? (tabParam as SkillsTab) : 'active';
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
    // Only update if actually changed
    if (next.toString() !== searchParams.toString()) {
      setSearchParams(next, { replace: true });
    }
  }, [debouncedSearch]);

  const skills = data?.data ?? [];

  const filteredSkills = useMemo(() => {
    if (tab === 'marketplace') return [];
    const filterFn = tabStatusFilters[tab];
    return skills.filter((s) => filterFn(s.status));
  }, [skills, tab]);

  const handleTabChange = (_: React.SyntheticEvent, val: string) => {
    const nextTab = val as SkillsTab;
    setSearch('');
    setDebouncedSearch('');
    const next = new URLSearchParams();
    if (nextTab !== 'active') {
      next.set('tab', nextTab);
    }
    setSearchParams(next, { replace: true });
  };

  const isMarketplace = tab === 'marketplace';

  return (
    <Box sx={{ maxWidth: tokens.page.maxWidth, mx: 'auto' }}>
      <PageHeader
        title="Skills"
        description="Manage and inspect skills loaded from various sources."
      />

      <Tabs
        value={tab}
        onChange={handleTabChange}
        variant="scrollable"
        scrollButtons={false}
        sx={{ mt: -2, mb: 2, '& .MuiTab-root': { textTransform: 'none' } }}
      >
        <Tab label="Active" value="active" />
        <Tab label="Available" value="available" />
        <Tab label="Blocked" value="blocked" />
        <Tab label="Marketplace" value="marketplace" />
      </Tabs>

      <Box sx={{ mb: 3 }}>
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder={isMarketplace ? 'Search the global internet...' : 'Search skills...'}
        />
      </Box>

      <Card>
        <CardContent sx={{ p: 1 }}>
          {isMarketplace ? (
            <MarketplaceList
              search={debouncedSearch}
              onSelect={(slug) => navigate(`/skills/${slug}`)}
            />
          ) : isLoading ? (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, p: 2 }}>
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} variant="rectangular" height={52} sx={{ borderRadius: 1 }} />
              ))}
            </Box>
          ) : filteredSkills.length === 0 ? (
            <EmptyState
              icon={<Zap size={28} />}
              title={tabEmptyMessages[tab as Exclude<SkillsTab, 'marketplace'>]?.title ?? 'No skills found'}
              description={tabEmptyMessages[tab as Exclude<SkillsTab, 'marketplace'>]?.description ?? 'Skills will appear here once they are discovered.'}
            />
          ) : (
            <SkillsList
              skills={filteredSkills}
              search={search}
              statusFilter="all"
              onSelect={(name) => navigate(`/skills/${name}`)}
            />
          )}
        </CardContent>
      </Card>
    </Box>
  );
}
