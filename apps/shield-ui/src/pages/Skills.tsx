/**
 * Skills page - skill scanning and management
 */

import { useState, useMemo } from 'react';
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
import { SidePanel } from '../components/shared/SidePanel';
import { SkillsList } from '../components/skills/SkillsList';
import { SkillDetails } from '../components/skills/SkillDetails';
import { MarketplaceList } from '../components/skills/MarketplaceList';
import { MarketplaceSkillDetails } from '../components/skills/MarketplaceSkillDetails';

const tabEmptyMessages: Record<Exclude<SkillsTab, 'marketplace'>, { title: string; description: string }> = {
  active: {
    title: 'No active skills',
    description: 'Activated skills will appear here.',
  },
  available: {
    title: 'No available skills',
    description: 'Disabled or workspace skills will appear here.',
  },
  blocked: {
    title: 'No blocked skills',
    description: 'Quarantined skills will appear here.',
  },
};

const tabStatusFilters: Record<Exclude<SkillsTab, 'marketplace'>, (status: string) => boolean> = {
  active: (status) => status === 'active',
  available: (status) => status === 'disabled' || status === 'workspace',
  blocked: (status) => status === 'quarantined',
};

export function Skills() {
  const { data, isLoading } = useSkills();
  const [search, setSearch] = useState('');
  const [tab, setTab] = useState<SkillsTab>('active');
  const [selectedSkill, setSelectedSkill] = useState<string | null>(null);
  const [selectedMarketplaceSkill, setSelectedMarketplaceSkill] = useState<string | null>(null);

  const skills = data?.data ?? [];

  const filteredSkills = useMemo(() => {
    if (tab === 'marketplace') return [];
    const filterFn = tabStatusFilters[tab];
    return skills.filter((s) => filterFn(s.status));
  }, [skills, tab]);

  const handleTabChange = (_: React.SyntheticEvent, val: string) => {
    setTab(val as SkillsTab);
    setSelectedSkill(null);
    setSelectedMarketplaceSkill(null);
    setSearch('');
  };

  const isMarketplace = tab === 'marketplace';

  return (
    <Box sx={{ maxWidth: tokens.page.maxWidth, mx: 'auto', display: 'flex' }}>
      <Box sx={{ flex: 1, minWidth: 0 }}>
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
                search={search}
                selectedSkill={selectedMarketplaceSkill}
                onSelect={(slug) => {
                  setSelectedMarketplaceSkill(slug);
                  setSelectedSkill(null);
                }}
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
                selectedSkill={selectedSkill}
                onSelect={(name) => {
                  setSelectedSkill(name);
                  setSelectedMarketplaceSkill(null);
                }}
              />
            )}
          </CardContent>
        </Card>
      </Box>

      <SidePanel
        open={!!selectedSkill}
        onClose={() => setSelectedSkill(null)}
        title="Skill Details"
      >
        {selectedSkill && <SkillDetails skillName={selectedSkill} />}
      </SidePanel>

      <SidePanel
        open={!!selectedMarketplaceSkill}
        onClose={() => setSelectedMarketplaceSkill(null)}
        title="Marketplace Skill"
      >
        {selectedMarketplaceSkill && <MarketplaceSkillDetails slug={selectedMarketplaceSkill} />}
      </SidePanel>
    </Box>
  );
}
