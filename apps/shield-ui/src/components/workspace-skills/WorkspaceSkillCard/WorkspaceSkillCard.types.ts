import type { WorkspaceSkillSummary } from '../../../api/client';

export interface WorkspaceSkillCardProps {
  skill: WorkspaceSkillSummary;
  onApprove: (id: string) => void;
  onRequestApproval: (id: string) => void;
  onDeny: (id: string) => void;
  cloudConnected?: boolean;
  isReadOnly?: boolean;
}
