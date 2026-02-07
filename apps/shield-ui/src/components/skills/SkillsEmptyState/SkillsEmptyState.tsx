import { Zap } from 'lucide-react';
import { EmptyState } from '../../shared/EmptyState';

export function SkillsEmptyState() {
  return (
    <EmptyState
      icon={<Zap size={28} />}
      title="No skills installed"
      description="Skills extend your agent's capabilities by adding new tools and commands. Search for skills above or drop a skill ZIP file to get started."
    />
  );
}
