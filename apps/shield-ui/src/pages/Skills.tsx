/**
 * Skills page - skill scanning and management
 */

import { useState } from 'react';
import {
  Box,
  Card,
  CardContent,
  Select,
  MenuItem,
  Skeleton,
} from '@mui/material';
import { Zap } from 'lucide-react';
import { useSkills } from '../api/hooks';
import { tokens } from '../styles/tokens';
import { PageHeader } from '../components/shared/PageHeader';
import { SearchInput } from '../components/shared/SearchInput';
import { EmptyState } from '../components/shared/EmptyState';
import { SidePanel } from '../components/shared/SidePanel';
import { SkillsList } from '../components/skills/SkillsList';
import { SkillDetails } from '../components/skills/SkillDetails';

export function Skills() {
  const { data, isLoading } = useSkills();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [selectedSkill, setSelectedSkill] = useState<string | null>(null);

  const skills = data?.data ?? [];

  return (
    <Box sx={{ maxWidth: tokens.page.maxWidth, mx: 'auto', display: 'flex' }}>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <PageHeader
          title="Skills"
          description="Manage and inspect skills loaded from various sources."
        />

        <Box sx={{ display: 'flex', gap: 2, mb: 3, alignItems: 'center' }}>
          <Box sx={{ flex: 1 }}>
            <SearchInput
              value={search}
              onChange={setSearch}
              placeholder="Search skills..."
            />
          </Box>
          <Select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            size="small"
            displayEmpty
            sx={{ minWidth: 140, height: 40 }}
          >
            <MenuItem value="all">All Statuses</MenuItem>
            <MenuItem value="active">Active</MenuItem>
            <MenuItem value="workspace">Workspace</MenuItem>
            <MenuItem value="quarantined">Quarantined</MenuItem>
            <MenuItem value="disabled">Disabled</MenuItem>
          </Select>
        </Box>

        <Card>
          <CardContent sx={{ p: 1 }}>
            {isLoading ? (
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, p: 2 }}>
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} variant="rectangular" height={52} sx={{ borderRadius: 1 }} />
                ))}
              </Box>
            ) : skills.length === 0 ? (
              <EmptyState
                icon={<Zap size={28} />}
                title="No skills found"
                description="Skills will appear here once they are discovered from your configured sources."
              />
            ) : (
              <SkillsList
                skills={skills}
                search={search}
                statusFilter={statusFilter}
                selectedSkill={selectedSkill}
                onSelect={setSelectedSkill}
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
    </Box>
  );
}
