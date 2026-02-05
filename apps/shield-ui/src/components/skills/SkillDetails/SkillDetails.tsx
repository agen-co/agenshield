import { Typography, Button, Skeleton, Box, Chip, CircularProgress, Alert } from '@mui/material';
import { ShieldCheck, ShieldOff, Power, PowerOff, RefreshCw, CheckCircle, XCircle, FolderOpen, Globe } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useSkill, useToggleSkill, useActivateSkill, useQuarantineSkill, useReanalyzeSkill } from '../../../api/hooks';
import { StatusBadge } from '../../shared/StatusBadge';
import { MarkdownViewer } from '../../shared/MarkdownViewer';
import { parseSkillReadme } from '../../../utils/parseSkillReadme';
import { Root, ContentGrid, ReadmeCard, Sidebar, SidebarSection } from './SkillDetails.styles';
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

const vulnColors: Record<string, 'success' | 'info' | 'warning' | 'error'> = {
  safe: 'success',
  low: 'info',
  medium: 'warning',
  high: 'error',
  critical: 'error',
};

function MetaItem({ icon: Icon, label }: { icon: LucideIcon; label: string }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
      <Icon size={14} />
      <Typography variant="body2" sx={{ wordBreak: 'break-all' }}>{label}</Typography>
    </Box>
  );
}

function AnalysisCard({ analysis, onRetry, retrying }: { analysis: SkillAnalysis; onRetry: () => void; retrying: boolean }) {
  if (analysis.status === 'pending' || analysis.status === 'analyzing') {
    return (
      <Box
        sx={{
          border: 1,
          borderColor: 'divider',
          borderRadius: 2,
          px: 2,
          py: 1.5,
          display: 'flex',
          alignItems: 'center',
          gap: 1,
        }}
      >
        <CircularProgress size={14} />
        <Typography variant="body2" color="text.secondary">
          Analyzing skill...
        </Typography>
      </Box>
    );
  }

  if (analysis.status === 'error') {
    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        <Alert severity="error" sx={{ '.MuiAlert-message': { width: '100%' } }}>
          <Typography variant="body2" fontWeight={500} sx={{ mb: 0.5 }}>
            Analysis Failed
          </Typography>
          <Typography variant="caption">{analysis.error}</Typography>
        </Alert>
        <Button
          fullWidth
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

  const severity = vulnColors[analysis.vulnerability?.level ?? ''] ?? 'info';

  return (
    <Box
      sx={{
        border: 1,
        borderColor: (theme) => theme.palette[severity].main,
        borderRadius: 2,
        overflow: 'hidden',
      }}
    >
      {/* Header band */}
      <Box
        sx={{
          px: 2,
          py: 1.5,
          bgcolor: (theme) =>
            theme.palette.mode === 'dark'
              ? `${theme.palette[severity].main}1A`
              : `${theme.palette[severity].main}14`,
        }}
      >
        <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 0.5 }}>
          Analysis
        </Typography>
        {analysis.vulnerability && (
          <Chip
            label={analysis.vulnerability.level.toUpperCase()}
            color={severity}
            size="small"
            sx={{ fontWeight: 600 }}
          />
        )}
      </Box>

      {/* Body */}
      <Box sx={{ px: 2, py: 1.5 }}>
        {/* Vulnerability details */}
        {analysis.vulnerability && (
          <>
            {analysis.vulnerability.details.map((detail, i) => (
              <Typography key={i} variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.25 }}>
                {detail}
              </Typography>
            ))}
            {analysis.vulnerability.suggestions?.map((suggestion, i) => (
              <Typography key={i} variant="caption" color="info.main" sx={{ display: 'block', mt: 0.5 }}>
                {suggestion}
              </Typography>
            ))}
          </>
        )}

        {/* Commands */}
        {analysis.commands.length > 0 && (
          <Box sx={{ mt: 1.5 }}>
            <Typography variant="caption" fontWeight={600} sx={{ display: 'block', mb: 0.5 }}>
              Commands ({analysis.commands.length})
            </Typography>
            {analysis.commands.map((cmd: ExtractedCommand) => (
              <Box
                key={cmd.name}
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 0.5,
                  py: 0.25,
                }}
              >
                {cmd.available ? (
                  <CheckCircle size={12} color="var(--mui-palette-success-main, #6CB685)" />
                ) : (
                  <XCircle size={12} color="var(--mui-palette-error-main, #E1583E)" />
                )}
                <Typography variant="caption">{cmd.name}</Typography>
                {cmd.resolvedPath && (
                  <Typography variant="caption" color="text.secondary" sx={{ ml: 'auto', fontSize: '0.625rem' }}>
                    {cmd.resolvedPath}
                  </Typography>
                )}
              </Box>
            ))}
          </Box>
        )}

        {/* Re-analyze */}
        <Button
          fullWidth
          size="small"
          variant="text"
          color="secondary"
          startIcon={<RefreshCw size={12} />}
          onClick={onRetry}
          disabled={retrying}
          sx={{ mt: 1.5, fontSize: '0.75rem' }}
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

  const config = statusConfig[skill.status] ?? { label: skill.status, variant: 'default' as const };
  const { body: cleanContent } = parseSkillReadme(skill.content);

  return (
    <Root>
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.5 }}>
        <Typography variant="h5" fontWeight={600}>
          {skill.name}
        </Typography>
        <StatusBadge label={config.label} variant={config.variant} size="medium" />
      </Box>
      {skill.description && (
        <Typography variant="body2" color="text.secondary" sx={{ whiteSpace: 'pre-wrap', mb: 3 }}>
          {skill.description}
        </Typography>
      )}

      <ContentGrid>
        {/* Left: Readme */}
        <ReadmeCard>
          <MarkdownViewer content={cleanContent} />
        </ReadmeCard>

        {/* Right: Sidebar */}
        <Sidebar>
          {/* Action buttons */}
          <SidebarSection>
            {skill.status === 'quarantined' && (
              <Button
                fullWidth
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
                fullWidth
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
              fullWidth
              variant="outlined"
              startIcon={skill.status === 'disabled' ? <Power size={16} /> : <PowerOff size={16} />}
              onClick={() => toggleSkill.mutate(skill.name)}
              disabled={toggleSkill.isPending}
            >
              {skill.status === 'disabled' ? 'Enable' : 'Disable'}
            </Button>
          </SidebarSection>

          {/* About */}
          <SidebarSection>
            <Typography variant="subtitle2" color="text.secondary">About</Typography>
            <MetaItem icon={Globe} label={skill.source} />
            <MetaItem icon={FolderOpen} label={skill.path} />
          </SidebarSection>

          {/* Analysis */}
          {skill.analysis && (
            <AnalysisCard
              analysis={skill.analysis}
              onRetry={() => reanalyzeSkill.mutate({ name: skill.name, content: skill.content, metadata: skill.metadata })}
              retrying={reanalyzeSkill.isPending}
            />
          )}
        </Sidebar>
      </ContentGrid>
    </Root>
  );
}
