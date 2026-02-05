import { Typography, Button, Skeleton, Box, Chip, CircularProgress } from '@mui/material';
import { ShieldCheck, ShieldOff, Power, PowerOff, RefreshCw, CheckCircle, XCircle } from 'lucide-react';
import { useSkill, useToggleSkill, useActivateSkill, useQuarantineSkill, useReanalyzeSkill } from '../../../api/hooks';
import { StatusBadge } from '../../shared/StatusBadge';
import { MarkdownViewer } from '../../shared/MarkdownViewer';
import { Root, Header, Actions, MetaRow } from './SkillDetails.styles';
import type { SkillAnalysis, ExtractedCommand } from '@agenshield/ipc';

interface SkillDetailsProps {
  skillName: string;
}

const statusConfig = {
  active: { label: 'Active', variant: 'success' as const },
  workspace: { label: 'Workspace', variant: 'info' as const },
  quarantined: { label: 'Quarantined', variant: 'warning' as const },
  disabled: { label: 'Disabled', variant: 'default' as const },
};

const vulnColors: Record<string, 'success' | 'info' | 'warning' | 'error' | 'default'> = {
  safe: 'success',
  low: 'info',
  medium: 'warning',
  high: 'error',
  critical: 'error',
};

function AnalysisSection({ analysis, onRetry, retrying }: { analysis?: SkillAnalysis; onRetry: () => void; retrying: boolean }) {
  if (!analysis) return null;

  if (analysis.status === 'pending' || analysis.status === 'analyzing') {
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 1 }}>
        <CircularProgress size={14} />
        <Typography variant="body2" color="text.secondary">
          Analyzing skill...
        </Typography>
      </Box>
    );
  }

  if (analysis.status === 'error') {
    return (
      <Box sx={{ py: 1 }}>
        <Typography variant="body2" color="error.main" sx={{ mb: 1 }}>
          Analysis failed: {analysis.error}
        </Typography>
        <Button
          size="small"
          variant="outlined"
          color="secondary"
          startIcon={<RefreshCw size={14} />}
          onClick={onRetry}
          disabled={retrying}
        >
          Retry Analysis
        </Button>
      </Box>
    );
  }

  return (
    <Box sx={{ py: 1 }}>
      {/* Vulnerability */}
      {analysis.vulnerability && (
        <Box sx={{ mb: 2 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
            <Typography variant="subtitle2">Vulnerability</Typography>
            <Chip
              label={analysis.vulnerability.level}
              color={vulnColors[analysis.vulnerability.level] ?? 'default'}
              size="small"
              variant="outlined"
            />
          </Box>
          {analysis.vulnerability.details.map((detail, i) => (
            <Typography key={i} variant="caption" color="text.secondary" sx={{ display: 'block' }}>
              {detail}
            </Typography>
          ))}
          {analysis.vulnerability.suggestions?.map((suggestion, i) => (
            <Typography key={i} variant="caption" color="info.main" sx={{ display: 'block', mt: 0.5 }}>
              {suggestion}
            </Typography>
          ))}
        </Box>
      )}

      {/* Commands */}
      {analysis.commands.length > 0 && (
        <Box>
          <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
            Commands ({analysis.commands.length})
          </Typography>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
            {analysis.commands.map((cmd: ExtractedCommand) => (
              <Box
                key={cmd.name}
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1,
                  px: 1,
                  py: 0.5,
                  borderRadius: 1,
                  bgcolor: 'action.hover',
                }}
              >
                {cmd.available ? (
                  <CheckCircle size={14} color="var(--mui-palette-success-main, #6CB685)" />
                ) : (
                  <XCircle size={14} color="var(--mui-palette-error-main, #E1583E)" />
                )}
                <Typography variant="code" sx={{ fontSize: '0.8125rem' }}>
                  {cmd.name}
                </Typography>
                <Chip
                  label={cmd.source}
                  size="small"
                  variant="outlined"
                  sx={{ height: 18, fontSize: '0.625rem' }}
                />
                {cmd.resolvedPath && (
                  <Typography variant="caption" color="text.secondary" sx={{ ml: 'auto' }}>
                    {cmd.resolvedPath}
                  </Typography>
                )}
              </Box>
            ))}
          </Box>
        </Box>
      )}

      {/* Retry */}
      <Box sx={{ mt: 1.5 }}>
        <Button
          size="small"
          variant="text"
          color="secondary"
          startIcon={<RefreshCw size={12} />}
          onClick={onRetry}
          disabled={retrying}
          sx={{ fontSize: '0.75rem' }}
        >
          Re-analyze
        </Button>
      </Box>
    </Box>
  );
}

export function SkillDetails({ skillName }: SkillDetailsProps) {
  const { data, isLoading } = useSkill(skillName);
  const toggleSkill = useToggleSkill();
  const activateSkill = useActivateSkill();
  const quarantineSkill = useQuarantineSkill();
  const reanalyzeSkill = useReanalyzeSkill();

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

      {/* Analysis section */}
      {skill.analysis && (
        <Box sx={{ mt: 2, pt: 2, borderTop: (theme) => `1px solid ${theme.palette.divider}` }}>
          <Typography variant="subtitle1" sx={{ mb: 0.5 }}>
            Analysis
          </Typography>
          <AnalysisSection
            analysis={skill.analysis}
            onRetry={() => reanalyzeSkill.mutate({ name: skill.name, content: skill.content, metadata: skill.metadata })}
            retrying={reanalyzeSkill.isPending}
          />
        </Box>
      )}

      <Box sx={{ mt: 3, flex: 1, overflow: 'auto' }}>
        <MarkdownViewer content={skill.content} />
      </Box>
    </Root>
  );
}
