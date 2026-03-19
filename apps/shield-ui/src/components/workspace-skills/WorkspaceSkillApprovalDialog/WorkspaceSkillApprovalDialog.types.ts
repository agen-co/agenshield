import type { WorkspaceSkillSummary } from '../../../api/client';

export interface WorkspaceSkillApprovalDialogProps {
  open: boolean;
  skill: WorkspaceSkillSummary | null;
  action: 'approve' | 'request-approval' | 'deny';
  onConfirm: () => void;
  onCancel: () => void;
  isLoading?: boolean;
  error?: string | null;
}
