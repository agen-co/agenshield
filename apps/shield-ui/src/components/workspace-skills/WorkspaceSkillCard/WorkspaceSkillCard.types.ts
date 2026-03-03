import type { WorkspaceSkillSummary } from '../../../api/client';

export interface WorkspaceSkillCardProps {
  skill: WorkspaceSkillSummary;
  onApprove: (id: string) => void;
  onDeny: (id: string) => void;
  isReadOnly?: boolean;
}
