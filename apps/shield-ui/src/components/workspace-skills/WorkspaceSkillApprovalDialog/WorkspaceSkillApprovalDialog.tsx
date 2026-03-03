import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Typography,
  Alert,
  Box,
} from '@mui/material';
import PrimaryButton from '../../../elements/buttons/PrimaryButton';
import SecondaryButton from '../../../elements/buttons/SecondaryButton';
import DangerButton from '../../../elements/buttons/DangerButton';
import { CircularLoader } from '../../../elements/loaders/CircularLoader';
import type { WorkspaceSkillApprovalDialogProps } from './WorkspaceSkillApprovalDialog.types';

export function WorkspaceSkillApprovalDialog({
  open,
  skill,
  action,
  onConfirm,
  onCancel,
  isLoading,
  error,
}: WorkspaceSkillApprovalDialogProps) {
  if (!skill) return null;

  const isApprove = action === 'approve';

  return (
    <Dialog open={open} onClose={onCancel} maxWidth="sm" fullWidth>
      <DialogTitle>
        {isApprove ? 'Approve Workspace Skill' : 'Deny Workspace Skill'}
      </DialogTitle>
      <DialogContent>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
          <Typography variant="body2">
            {isApprove
              ? 'This will allow the agent to read this skill. A backup will be created for tamper detection.'
              : 'This will block the agent from reading this skill.'}
          </Typography>

          <Box
            sx={{
              p: 2,
              borderRadius: 1,
              bgcolor: 'action.hover',
              fontFamily: "'IBM Plex Mono', monospace",
            }}
          >
            <Typography variant="body2" fontWeight={600}>
              {skill.skillName}
            </Typography>
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ wordBreak: 'break-all' }}
            >
              {skill.workspacePath}
            </Typography>
            {skill.contentHash && (
              <Typography
                variant="caption"
                color="text.secondary"
                display="block"
                sx={{ mt: 0.5 }}
              >
                Hash: {skill.contentHash.slice(0, 16)}...
              </Typography>
            )}
          </Box>

          {error && (
            <Alert severity="error" sx={{ mt: 1 }}>
              {error}
            </Alert>
          )}
        </Box>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <SecondaryButton onClick={onCancel} disabled={isLoading}>
          Cancel
        </SecondaryButton>
        {isApprove ? (
          <PrimaryButton onClick={onConfirm} disabled={isLoading}>
            {isLoading ? <CircularLoader size={16} /> : 'Approve'}
          </PrimaryButton>
        ) : (
          <DangerButton onClick={onConfirm} disabled={isLoading}>
            {isLoading ? <CircularLoader size={16} /> : 'Deny'}
          </DangerButton>
        )}
      </DialogActions>
    </Dialog>
  );
}
