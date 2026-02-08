/**
 * Unified skill detail view.
 * Two-column layout: LEFT = metadata, RIGHT = analysis accordion + readme markdown.
 * Reads from the valtio skillsStore — skill is found via selectedSlug in the skills list.
 */

import {
  Typography,
  Chip,
  Box,
  Divider,
  Alert,
  Accordion,
  AccordionSummary,
  AccordionDetails,
} from '@mui/material';
import {
  RefreshCw,
  CheckCircle,
  XCircle,
  Terminal,
  User,
  Tag,
  Download,
  Search,
  ChevronDown,
} from 'lucide-react';
import { useSnapshot } from 'valtio';
import PrimaryButton from '../../../elements/buttons/PrimaryButton';
import SecondaryButton from '../../../elements/buttons/SecondaryButton';
import DangerButton from '../../../elements/buttons/DangerButton';
import { CircularLoader } from '../../../elements/loaders/CircularLoader';
import { MarkdownViewer } from '../../shared/MarkdownViewer';
import {
  skillsStore,
  analyzeSkill,
  installSkill,
  uninstallSkill,
  unblockSkill,
  reinstallUntrustedSkill,
  deleteUntrustedSkill,
} from '../../../stores/skills';
import { useGuardedAction } from '../../../hooks/useGuardedAction';
import { VulnBadge } from '../../shared/VulnBadge';
import { Root, ContentGrid, MetadataColumn, ReadmeCard, MetadataSection } from './SkillDetails.styles';

const vulnColors: Record<string, 'success' | 'info' | 'warning' | 'error'> = {
  safe: 'success',
  low: 'info',
  medium: 'warning',
  high: 'error',
  critical: 'error',
};

const originChipConfig: Record<string, { label: string; color: 'warning' | 'default' }> = {
  blocked: { label: 'Blocked', color: 'warning' },
  local: { label: 'Local', color: 'default' },
  search: { label: 'Marketplace', color: 'default' },
  untrusted: { label: 'Untrusted', color: 'warning' },
};

export function SkillDetails() {
  const snap = useSnapshot(skillsStore);
  const guard = useGuardedAction();

  // Read from the single list using selectedSlug
  const skill = snap.skills.find((s) => s.slug === snap.selectedSlug || s.name === snap.selectedSlug);
  const readme = skill?.readme;

  if (!skill) {
    return (
      <Root>
        <Typography color="text.secondary">Skill not found.</Typography>
      </Root>
    );
  }

  const chipConfig = originChipConfig[skill.origin];
  const vulnLevel = skill.analysis?.vulnerability?.level
    ?? (skill.origin === 'untrusted' ? 'critical' : undefined);

  const isUntrustedAnalyzed = skill.origin === 'untrusted' && skill.actionState === 'analyzed';

  const getActionLabel = (state: string) => {
    if (isUntrustedAnalyzed) return 'Reinstall';
    switch (state) {
      case 'not_analyzed': case 'analysis_failed': return 'Analyze';
      case 'analyzed': return 'Install';
      case 'installed': return 'Uninstall';
      case 'blocked': return 'Unblock';
      default: return 'Manage';
    }
  };

  const handleAction = () => {
    const label = getActionLabel(skill.actionState);
    guard(async () => {
      if (isUntrustedAnalyzed) {
        await reinstallUntrustedSkill(skill.name);
        return;
      }
      switch (skill.actionState) {
        case 'not_analyzed':
        case 'analysis_failed':
          await analyzeSkill(skill.slug);
          break;
        case 'analyzed':
          await installSkill(skill.slug);
          break;
        case 'installed':
          await uninstallSkill(skill.name);
          break;
        case 'blocked':
          await analyzeSkill(skill.slug);
          await unblockSkill(skill.name);
          break;
      }
    }, { description: `Unlock to ${label.toLowerCase()} this skill.`, actionLabel: label });
  };

  return (
    <Root>
      <ContentGrid>
        {/* LEFT COLUMN: Metadata */}
        <MetadataColumn>
          {/* Title + origin */}
          <Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
              <Typography variant="h5" fontWeight={600}>
                {skill.name}
              </Typography>
              {skill.version && (
                <Typography variant="body2" color="text.secondary">
                  v{skill.version}
                </Typography>
              )}
              {chipConfig && (
                <Chip
                  label={chipConfig.label}
                  color={chipConfig.color}
                  size="small"
                  sx={{ fontWeight: 500 }}
                />
              )}
            </Box>
            {skill.description && (
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                {skill.description}
              </Typography>
            )}
          </Box>

          {/* Author */}
          {skill.author && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <User size={14} />
              <Typography variant="body2">{skill.author}</Typography>
            </Box>
          )}

          {/* Action button */}
          <ActionButton actionState={skill.actionState} vulnLevel={vulnLevel} onClick={handleAction} />

          {/* Delete button for untrusted skills */}
          {skill.origin === 'untrusted' && (
            <DangerButton
              fullWidth
              onClick={() => guard(() => deleteUntrustedSkill(skill.name), {
                description: 'Unlock to delete this untrusted skill permanently.',
                actionLabel: 'Delete',
              })}
            >
              Delete from disk
            </DangerButton>
          )}

          <Divider />

          {/* Run Commands */}
          {skill.analysis?.commands && skill.analysis.commands.length > 0 && (
            <MetadataSection>
              <Typography variant="subtitle2" fontWeight={600}>
                <Terminal size={14} style={{ marginRight: 6, verticalAlign: 'middle' }} />
                Commands ({skill.analysis.commands.length})
              </Typography>
              {skill.analysis.commands.map((cmd) => (
                <Box
                  key={cmd.name}
                  sx={{ display: 'flex', alignItems: 'center', gap: 0.5, py: 0.25 }}
                >
                  {cmd.available ? (
                    <CheckCircle size={12} color="var(--mui-palette-success-main, #6CB685)" />
                  ) : (
                    <XCircle size={12} color="var(--mui-palette-error-main, #E1583E)" />
                  )}
                  <Typography variant="caption" fontFamily="'IBM Plex Mono', monospace">
                    {cmd.name}
                  </Typography>
                </Box>
              ))}
            </MetadataSection>
          )}

          {/* Environment Variables */}
          {skill.envVariables && skill.envVariables.length > 0 && (
            <MetadataSection>
              <Typography variant="subtitle2" fontWeight={600}>
                Environment Variables
              </Typography>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                {skill.envVariables!.map((ev, idx, arr) => (
                  <Box key={ev.name}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <Typography variant="caption" fontFamily="'IBM Plex Mono', monospace">
                        {ev.name}
                      </Typography>
                      {ev.required && <Chip label="required" size="small" color="warning" sx={{ height: 16, fontSize: '0.6rem' }} />}
                      {ev.sensitive && <Chip label="sensitive" size="small" color="error" sx={{ height: 16, fontSize: '0.6rem' }} />}
                    </Box>
                    {ev.purpose && (
                      <Typography variant="caption" color="text.secondary">
                        {ev.purpose}
                      </Typography>
                    )}
                    {idx !== arr.length - 1 && <Divider sx={{ mt: 1.5 }} />}
                  </Box>
                ))}
              </Box>
            </MetadataSection>
          )}

          {/* Tags */}
          {skill.tags && skill.tags.length > 0 && (
            <MetadataSection>
              <Typography variant="subtitle2" fontWeight={600}>
                <Tag size={14} style={{ marginRight: 6, verticalAlign: 'middle' }} />
                Tags
              </Typography>
              <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                {skill.tags.map((tag) => (
                  <Chip key={tag} label={tag} size="small" variant="outlined" />
                ))}
              </Box>
            </MetadataSection>
          )}
        </MetadataColumn>

        {/* RIGHT COLUMN: Analysis + Readme */}
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
          {/* Analysis accordion */}
          {skill.analysis && skill.actionState !== 'analysis_failed' && (
            <Accordion
              defaultExpanded={vulnLevel === 'medium' || vulnLevel === 'high' || vulnLevel === 'critical'}
              disableGutters
              elevation={0}
              sx={{
                border: 1,
                borderColor: 'divider',
                borderRadius: (theme) => (theme.shape.borderRadius as number) * 2,
                '&:before': { display: 'none' },
                overflow: 'hidden',
              }}
            >
              <AccordionSummary expandIcon={<ChevronDown size={18} />}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                  {vulnLevel && <VulnBadge level={vulnLevel} size="normal" />}
                  <Typography variant="subtitle2" fontWeight={600}>Security Analysis</Typography>
                </Box>
              </AccordionSummary>
              <AccordionDetails>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                  {skill.analysis.vulnerability?.details?.map((detail, i) => (
                    <Typography key={i} variant="caption" color="text.secondary">
                      {detail}
                    </Typography>
                  ))}
                  {skill.analysis.vulnerability?.suggestions?.map((s, i) => (
                    <Typography key={i} variant="caption" color="info.main">
                      {s}
                    </Typography>
                  ))}

                  {/* Security findings */}
                  {skill.analysis.securityFindings && skill.analysis.securityFindings.length > 0 && (
                    <Box sx={{ mt: 1 }}>
                      {skill.analysis.securityFindings.map((f, i) => (
                        <Alert key={i} severity={vulnColors[f.severity] ?? 'info'} sx={{ mb: 0.5, py: 0, '& .MuiAlert-message': { fontSize: '0.75rem' } }}>
                          {f.cwe && <strong>{f.cwe}: </strong>}
                          {f.description}
                        </Alert>
                      ))}
                    </Box>
                  )}

                  {/* MCP risks */}
                  {skill.analysis.mcpSpecificRisks && skill.analysis.mcpSpecificRisks.length > 0 && (
                    <Box sx={{ mt: 1 }}>
                      <Typography variant="caption" fontWeight={600} display="block" sx={{ mb: 0.5 }}>
                        MCP-Specific Risks
                      </Typography>
                      {skill.analysis.mcpSpecificRisks.map((r, i) => (
                        <Typography key={i} variant="caption" color="text.secondary" display="block">
                          <Chip label={r.riskType} size="small" sx={{ height: 16, fontSize: '0.6rem', mr: 0.5 }} />
                          {r.description}
                        </Typography>
                      ))}
                    </Box>
                  )}

                  {/* Re-analyze button */}
                  <SecondaryButton
                    size="small"
                    onClick={() => guard(() => analyzeSkill(skill.slug), { description: 'Unlock to re-analyze this skill.', actionLabel: 'Re-analyze' })}
                    sx={{ mt: 1 }}
                  >
                    <RefreshCw size={12} style={{ marginRight: 6 }} />
                    Re-analyze
                  </SecondaryButton>
                </Box>
              </AccordionDetails>
            </Accordion>
          )}

          <ReadmeCard>
            {snap.selectedLoading ? (
              <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
                <CircularLoader size={24} />
              </Box>
            ) : readme ? (
              <MarkdownViewer content={readme} />
            ) : (
              <Typography variant="body2" color="text.secondary">
                No readme available.
              </Typography>
            )}
          </ReadmeCard>
        </Box>
      </ContentGrid>
    </Root>
  );
}

function ActionButton({
  actionState,
  vulnLevel,
  onClick,
}: {
  actionState: string;
  vulnLevel?: string;
  onClick: () => void;
}) {
  switch (actionState) {
    case 'not_analyzed':
      return (
        <PrimaryButton fullWidth onClick={onClick}>
          <Search size={14} style={{ marginRight: 6 }} />
          Analyze
        </PrimaryButton>
      );
    case 'analyzing':
      return (
        <SecondaryButton fullWidth disabled>
          <CircularLoader size={14} sx={{ mr: 1 }} />
          Analyzing...
        </SecondaryButton>
      );
    case 'analysis_failed':
      return (
        <PrimaryButton fullWidth onClick={onClick}>
          <Search size={14} style={{ marginRight: 6 }} />
          Analyze
        </PrimaryButton>
      );
    case 'analyzed':
      if (vulnLevel === 'critical') {
        return (
          <Box>
            <PrimaryButton fullWidth disabled>
              <Download size={14} style={{ marginRight: 6 }} />
              Install
            </PrimaryButton>
            <Alert severity="error" sx={{ mt: 1, py: 0 }}>
              Critical vulnerability detected — installation blocked.
            </Alert>
          </Box>
        );
      }
      return (
        <PrimaryButton fullWidth onClick={onClick}>
          <Download size={14} style={{ marginRight: 6 }} />
          Install
        </PrimaryButton>
      );
    case 'installing':
      return (
        <PrimaryButton fullWidth disabled>
          <CircularLoader size={14} sx={{ mr: 1 }} />
          Installing...
        </PrimaryButton>
      );
    case 'installed':
      return <DangerButton fullWidth onClick={onClick}>Uninstall</DangerButton>;
    case 'blocked':
      return <PrimaryButton fullWidth onClick={onClick}>Unblock</PrimaryButton>;
    default:
      return null;
  }
}
