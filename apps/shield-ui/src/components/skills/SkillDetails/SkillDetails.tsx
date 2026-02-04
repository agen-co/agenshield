import { Typography, Button, Skeleton, Box } from '@mui/material';
import { ShieldCheck, ShieldOff, Power, PowerOff } from 'lucide-react';
import { useSkill, useToggleSkill, useActivateSkill, useQuarantineSkill } from '../../../api/hooks';
import { StatusBadge } from '../../shared/StatusBadge';
import { MarkdownViewer } from '../../shared/MarkdownViewer';
import { Root, Header, Actions, MetaRow } from './SkillDetails.styles';

interface SkillDetailsProps {
  skillName: string;
}

const statusConfig = {
  active: { label: 'Active', variant: 'success' as const },
  workspace: { label: 'Workspace', variant: 'info' as const },
  quarantined: { label: 'Quarantined', variant: 'warning' as const },
  disabled: { label: 'Disabled', variant: 'default' as const },
};

export function SkillDetails({ skillName }: SkillDetailsProps) {
  const { data, isLoading } = useSkill(skillName);
  const toggleSkill = useToggleSkill();
  const activateSkill = useActivateSkill();
  const quarantineSkill = useQuarantineSkill();

  const skill = data?.data;

  if (isLoading) {
    return (
      <Root>
        <Skeleton variant="text" width="60%" height={40} />
        <Skeleton variant="rectangular" height={200} sx={{ mt: 2, borderRadius: 1 }} />
      </Root>
    );
  }

  if (!skill) {
    return (
      <Root>
        <Typography color="text.secondary">Skill not found.</Typography>
      </Root>
    );
  }

  const config = statusConfig[skill.status];

  return (
    <Root>
      <Header>
        <Box>
          <Typography variant="h5" fontWeight={600}>
            {skill.name}
          </Typography>
          {skill.description && (
            <Typography variant="body2" color="text.secondary">
              {skill.description}
            </Typography>
          )}
        </Box>
        <StatusBadge label={config.label} variant={config.variant} size="medium" />
      </Header>

      <MetaRow>
        <Typography variant="caption" color="text.secondary">
          Source: {skill.source}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          Path: {skill.path}
        </Typography>
      </MetaRow>

      <Actions>
        {skill.status === 'quarantined' && (
          <Button
            size="small"
            variant="contained"
            startIcon={<ShieldCheck size={16} />}
            onClick={() => activateSkill.mutate(skill.name)}
            disabled={activateSkill.isPending}
          >
            Activate
          </Button>
        )}
        {skill.status === 'active' && (
          <Button
            size="small"
            variant="outlined"
            color="warning"
            startIcon={<ShieldOff size={16} />}
            onClick={() => quarantineSkill.mutate(skill.name)}
            disabled={quarantineSkill.isPending}
          >
            Quarantine
          </Button>
        )}
        <Button
          size="small"
          variant="outlined"
          startIcon={skill.status === 'disabled' ? <Power size={16} /> : <PowerOff size={16} />}
          onClick={() => toggleSkill.mutate(skill.name)}
          disabled={toggleSkill.isPending}
        >
          {skill.status === 'disabled' ? 'Enable' : 'Disable'}
        </Button>
      </Actions>

      <Box sx={{ mt: 3, flex: 1, overflow: 'auto' }}>
        <MarkdownViewer content={skill.content} />
      </Box>
    </Root>
  );
}
