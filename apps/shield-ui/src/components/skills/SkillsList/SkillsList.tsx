import { useMemo } from 'react';
import type { SkillSummary } from '../../../api/client';
import { SkillCard } from '../SkillCard';
import { Root, GroupLabel } from './SkillsList.styles';

interface SkillsListProps {
  skills: SkillSummary[];
  search: string;
  statusFilter: string;
  selectedSkill: string | null;
  onSelect: (name: string) => void;
}

const sourceLabels: Record<string, string> = {
  user: 'User Skills',
  workspace: 'Workspace Skills',
  quarantine: 'Quarantined',
};

export function SkillsList({ skills, search, statusFilter, selectedSkill, onSelect }: SkillsListProps) {
  const filtered = useMemo(() => {
    return skills.filter((s) => {
      const matchesSearch = !search || s.name.toLowerCase().includes(search.toLowerCase());
      const matchesStatus = !statusFilter || statusFilter === 'all' || s.status === statusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [skills, search, statusFilter]);

  const grouped = useMemo(() => {
    const groups = new Map<string, SkillSummary[]>();
    for (const skill of filtered) {
      const list = groups.get(skill.source) ?? [];
      list.push(skill);
      groups.set(skill.source, list);
    }
    return groups;
  }, [filtered]);

  return (
    <Root>
      {Array.from(grouped.entries()).map(([source, items]) => (
        <div key={source}>
          <GroupLabel>{sourceLabels[source] ?? source}</GroupLabel>
          {items.map((skill) => (
            <SkillCard
              key={skill.name}
              skill={skill}
              selected={selectedSkill === skill.name}
              onClick={() => onSelect(skill.name)}
            />
          ))}
        </div>
      ))}
    </Root>
  );
}
