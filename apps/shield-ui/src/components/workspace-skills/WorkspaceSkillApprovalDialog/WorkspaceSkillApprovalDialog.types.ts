import type { WorkspaceSkillSummary } from '../../../api/client';

export interface WorkspaceSkillApprovalDialogProps {
  open: boolean;
  skill: WorkspaceSkillSummary | null;
  action: 'approve' | 'deny';
  onConfirm: () => void;
  onCancel: () => void;
  isLoading?: boolean;
  error?: string | null;
}
