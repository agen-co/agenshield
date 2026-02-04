import type { SkillSummary } from '../../../api/client';

export interface SkillCardProps {
  skill: SkillSummary;
  selected?: boolean;
  onClick: () => void;
}
