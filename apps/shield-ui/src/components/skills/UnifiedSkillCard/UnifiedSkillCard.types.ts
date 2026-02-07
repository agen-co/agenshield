import type { UnifiedSkill } from '../../../stores/skills';

export interface UnifiedSkillCardProps {
  skill: UnifiedSkill;
  selected?: boolean;
  readOnly?: boolean;
  onClick?: () => void;
  onAction?: (e: React.MouseEvent) => void;
  onDelete?: (e: React.MouseEvent) => void;
}
