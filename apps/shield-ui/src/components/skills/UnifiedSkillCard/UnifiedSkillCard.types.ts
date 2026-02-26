import type { UnifiedSkill } from '../../../stores/skills';

export interface UnifiedSkillCardProps {
  skill: UnifiedSkill;
  selected?: boolean;
  readOnly?: boolean;
  /** When set, the card shows per-target installation status instead of global */
  targetProfileId?: string;
  onClick?: () => void;
  onAction?: (e: React.MouseEvent) => void;
  onDelete?: (e: React.MouseEvent) => void;
}
