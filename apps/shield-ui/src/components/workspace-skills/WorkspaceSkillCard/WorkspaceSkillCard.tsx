import { Typography, Tooltip } from '@mui/material';
import { ShieldCheck, ShieldX, Clock, Cloud, FolderOpen } from 'lucide-react';
import { StatusBadge } from '../../shared/StatusBadge';
import PrimaryButton from '../../../elements/buttons/PrimaryButton';
import SecondaryButton from '../../../elements/buttons/SecondaryButton';
import DangerButton from '../../../elements/buttons/DangerButton';
import { Root, Info, Actions } from './WorkspaceSkillCard.styles';
import type { WorkspaceSkillCardProps } from './WorkspaceSkillCard.types';
import type { StatusVariant } from '../../shared/StatusBadge/StatusBadge.types';

const STATUS_CONFIG: Record<string, { label: string; variant: StatusVariant; icon: typeof Clock }> = {
  pending: { label: 'Pending', variant: 'warning', icon: Clock },
  approved: { label: 'Approved', variant: 'success', icon: ShieldCheck },
  denied: { label: 'Denied', variant: 'error', icon: ShieldX },
  cloud_forced: { label: 'Cloud', variant: 'info', icon: Cloud },
  removed: { label: 'Removed', variant: 'default', icon: FolderOpen },
};

export function WorkspaceSkillCard({ skill, onApprove, onRequestApproval, onDeny, cloudConnected, isReadOnly }: WorkspaceSkillCardProps) {
  const config = STATUS_CONFIG[skill.status] ?? STATUS_CONFIG.pending;

  // Cloud mode: only show actions for pending skills (backend rejects non-pending)
  // Local mode: show actions for pending or denied
  const canAct = !isReadOnly && (cloudConnected
    ? skill.status === 'pending'
    : skill.status === 'pending' || skill.status === 'denied');

  // If cloud-connected and skill already has a cloudSkillId but is still pending,
  // it has been submitted for review — show "Pending Review" instead of action buttons
  const pendingReview = cloudConnected && skill.cloudSkillId && skill.status === 'pending';

  return (
    <Root>
      <Info>
        <Typography variant="subtitle2" noWrap>
          {skill.skillName}
        </Typography>
        <Tooltip title={skill.workspacePath} placement="bottom-start">
          <Typography
            variant="body2"
            color="text.secondary"
            noWrap
            sx={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '0.75rem' }}
          >
            {skill.workspacePath}
          </Typography>
        </Tooltip>
        {skill.approvedBy && (
          <Typography variant="caption" color="text.secondary">
            {skill.status === 'cloud_forced' ? 'Pushed by cloud' : `Approved by ${skill.approvedBy}`}
          </Typography>
        )}
      </Info>

      <StatusBadge label={config.label} variant={config.variant} size="small" dot />

      {pendingReview && (
        <Actions>
          <SecondaryButton size="small" disabled>
            Pending Review
          </SecondaryButton>
        </Actions>
      )}

      {canAct && !pendingReview && (
        <Actions>
          {cloudConnected ? (
            <PrimaryButton
              size="small"
              onClick={(e: React.MouseEvent) => {
                e.stopPropagation();
                onRequestApproval(skill.id);
              }}
            >
              Request Approval
            </PrimaryButton>
          ) : (
            <PrimaryButton
              size="small"
              onClick={(e: React.MouseEvent) => {
                e.stopPropagation();
                onApprove(skill.id);
              }}
            >
              Approve
            </PrimaryButton>
          )}
          {skill.status === 'pending' && (
            <DangerButton
              size="small"
              onClick={(e: React.MouseEvent) => {
                e.stopPropagation();
                onDeny(skill.id);
              }}
            >
              Deny
            </DangerButton>
          )}
        </Actions>
      )}
    </Root>
  );
}
