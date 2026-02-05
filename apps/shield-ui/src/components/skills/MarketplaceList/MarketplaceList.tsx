import { Box, Skeleton } from '@mui/material';
import { Globe } from 'lucide-react';
import { useMarketplaceSearch } from '../../../api/hooks';
import { EmptyState } from '../../shared/EmptyState';
import { MarketplaceSkillCard } from '../MarketplaceSkillCard';

interface MarketplaceListProps {
  search: string;
  selectedSkill: string | null;
  onSelect: (slug: string) => void;
}

export function MarketplaceList({ search, selectedSkill, onSelect }: MarketplaceListProps) {
  const { data, isLoading, isError } = useMarketplaceSearch(search);
  const skills = data?.data ?? [];

  if (search.length < 2) {
    return (
      <EmptyState
        icon={<Globe size={28} />}
        title="Search the global internet"
        description="Type at least 2 characters to search for community skills."
      />
    );
  }

  if (isLoading) {
    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, p: 1 }}>
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} variant="rectangular" height={52} sx={{ borderRadius: 1 }} />
        ))}
      </Box>
    );
  }

  if (isError) {
    return (
      <EmptyState
        icon={<Globe size={28} />}
        title="Search failed"
        description="Could not reach the marketplace. Please try again later."
      />
    );
  }

  if (skills.length === 0) {
    return (
      <EmptyState
        icon={<Globe size={28} />}
        title="No skills found"
        description={`No marketplace skills matched "${search}".`}
      />
    );
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
      {skills.map((skill) => (
        <MarketplaceSkillCard
          key={skill.slug}
          skill={skill}
          selected={selectedSkill === skill.slug}
          onClick={() => onSelect(skill.slug)}
        />
      ))}
    </Box>
  );
}
