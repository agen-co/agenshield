import { useState } from 'react';
import { Typography, Skeleton, Box, IconButton, Tooltip } from '@mui/material';
import { RefreshCw, FolderOpen } from 'lucide-react';
import {
  useWorkspaceSkills,
  useApproveWorkspaceSkill,
  useDenyWorkspaceSkill,
  useRequestApprovalWorkspaceSkill,
  useScanWorkspaceSkills,
  useStatus,
} from '../../../api/hooks';
import type { WorkspaceSkillSummary } from '../../../api/client';
import { WorkspaceSkillCard } from '../WorkspaceSkillCard';
import { WorkspaceSkillApprovalDialog } from '../WorkspaceSkillApprovalDialog';
import { Root, WorkspaceGroup, SkillsList } from './WorkspaceSkillsPanel.styles';
import type { WorkspaceSkillsPanelProps } from './WorkspaceSkillsPanel.types';

export function WorkspaceSkillsPanel({ isReadOnly, profileId }: WorkspaceSkillsPanelProps) {
  const { data, isLoading } = useWorkspaceSkills();
  const { data: statusData } = useStatus();
  const cloudConnected = statusData?.data?.cloudConnected ?? false;

  const approveMutation = useApproveWorkspaceSkill();
  const denyMutation = useDenyWorkspaceSkill();
  const requestApprovalMutation = useRequestApprovalWorkspaceSkill();
  const scanMutation = useScanWorkspaceSkills();

  const [dialog, setDialog] = useState<{
    skill: WorkspaceSkillSummary;
    action: 'approve' | 'request-approval' | 'deny';
  } | null>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);

  const skills = data?.data ?? [];

  // Group skills by workspace path
  const grouped = skills.reduce<Record<string, WorkspaceSkillSummary[]>>((acc, skill) => {
    const key = skill.workspacePath;
    if (!acc[key]) acc[key] = [];
    acc[key].push(skill);
    return acc;
  }, {});

  const handleApprove = (id: string) => {
    const skill = skills.find((s) => s.id === id);
    if (skill) {
      setDialogError(null);
      setDialog({ skill, action: 'approve' });
    }
  };

  const handleRequestApproval = (id: string) => {
    const skill = skills.find((s) => s.id === id);
    if (skill) {
      setDialogError(null);
      setDialog({ skill, action: 'request-approval' });
    }
  };

  const handleDeny = (id: string) => {
    const skill = skills.find((s) => s.id === id);
    if (skill) {
      setDialogError(null);
      setDialog({ skill, action: 'deny' });
    }
  };

  const handleConfirm = async () => {
    if (!dialog) return;

    try {
      if (dialog.action === 'request-approval') {
        await requestApprovalMutation.mutateAsync(dialog.skill.id);
      } else if (dialog.action === 'approve') {
        await approveMutation.mutateAsync(dialog.skill.id);
      } else {
        await denyMutation.mutateAsync(dialog.skill.id);
      }
      setDialog(null);
    } catch (err) {
      setDialogError((err as Error).message);
    }
  };

  if (isLoading) {
    return (
      <Root>
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} variant="rectangular" height={72} sx={{ borderRadius: 2 }} />
        ))}
      </Root>
    );
  }

  if (skills.length === 0) {
    return (
      <Root>
        <Box
          sx={{
            textAlign: 'center',
            py: 6,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 1,
          }}
        >
          <FolderOpen size={40} strokeWidth={1.5} color="var(--mui-palette-text-secondary)" />
          <Typography variant="body2" color="text.secondary">
            {profileId
              ? 'No workspace skills detected for this target.'
              : 'No workspace skills detected.'}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {profileId
              ? 'Skills in `.claude/skills/` within workspaces assigned to this target will appear here.'
              : <>Skills in <code>.claude/skills/</code> within active workspaces will appear here.</>}
          </Typography>
        </Box>
      </Root>
    );
  }

  return (
    <Root>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Typography variant="subtitle2">
          {skills.length} skill{skills.length !== 1 ? 's' : ''} detected
        </Typography>
        {!isReadOnly && (
          <Tooltip title="Re-scan workspaces">
            <IconButton
              size="small"
              onClick={() => scanMutation.mutate(undefined)}
              disabled={scanMutation.isPending}
            >
              <RefreshCw size={16} />
            </IconButton>
          </Tooltip>
        )}
      </Box>

      {Object.entries(grouped).map(([workspacePath, wsSkills]) => (
        <WorkspaceGroup key={workspacePath}>
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ fontFamily: "'IBM Plex Mono', monospace" }}
          >
            {workspacePath}
          </Typography>
          <SkillsList>
            {wsSkills.map((skill) => (
              <WorkspaceSkillCard
                key={skill.id}
                skill={skill}
                onApprove={handleApprove}
                onRequestApproval={handleRequestApproval}
                onDeny={handleDeny}
                cloudConnected={cloudConnected}
                isReadOnly={isReadOnly}
              />
            ))}
          </SkillsList>
        </WorkspaceGroup>
      ))}

      <WorkspaceSkillApprovalDialog
        open={!!dialog}
        skill={dialog?.skill ?? null}
        action={dialog?.action ?? 'approve'}
        onConfirm={handleConfirm}
        onCancel={() => setDialog(null)}
        isLoading={approveMutation.isPending || denyMutation.isPending || requestApprovalMutation.isPending}
        error={dialogError}
      />
    </Root>
  );
}
