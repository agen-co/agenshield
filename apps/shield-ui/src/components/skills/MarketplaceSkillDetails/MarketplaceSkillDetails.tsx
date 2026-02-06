import { useState } from 'react';
import { Typography, Button, Skeleton, Box, Chip, CircularProgress, Divider, Alert, Accordion, AccordionSummary, AccordionDetails } from '@mui/material';
import { Download, RefreshCw, User, Tag, ExternalLink, CheckCircle, XCircle, ShieldAlert, AlertTriangle, ShieldCheck, Ban, Trash2, ChevronDown } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useMarketplaceSkill, useInstallMarketplaceSkill, useSkills, useToggleSkill } from '../../../api/hooks';
import type { AnalyzeSkillResponse } from '../../../api/marketplace.types';
import { MarkdownViewer } from '../../shared/MarkdownViewer';
import { parseSkillReadme } from '../../../utils/parseSkillReadme';
import { Root, ContentGrid, ReadmeCard, Sidebar, SidebarSection } from '../SkillDetails/SkillDetails.styles';

type InstallPhase = 'idle' | 'installing' | 'installed' | 'error';

interface MarketplaceSkillDetailsProps {
  slug: string;
}

const severityConfig: Record<string, { color: 'success' | 'info' | 'warning' | 'error'; icon: LucideIcon; label: string }> = {
  safe: { color: 'success', icon: ShieldCheck, label: 'Safe' },
  low: { color: 'info', icon: ShieldCheck, label: 'Low Risk' },
  medium: { color: 'warning', icon: AlertTriangle, label: 'Medium Risk' },
  high: { color: 'error', icon: ShieldAlert, label: 'High Risk' },
  critical: { color: 'error', icon: ShieldAlert, label: 'Critical' },
};

function MetaItem({ icon: Icon, label, href }: { icon: LucideIcon; label: string; href?: string }) {
  const content = (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
      <Icon size={14} />
      <Typography variant="body2">{label}</Typography>
    </Box>
  );
  if (href) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'none', color: 'inherit' }}>
        {content}
      </a>
    );
  }
  return content;
}

function AnalysisAccordion({
  analysis,
  isAnalysisPending,
}: {
  analysis: AnalyzeSkillResponse['analysis'] | null | undefined;
  isAnalysisPending: boolean;
}) {
  const config = analysis?.vulnerability?.level
    ? severityConfig[analysis.vulnerability.level] ?? severityConfig.safe
    : severityConfig.safe;
  const SeverityIcon = config.icon;

  // Pending state
  if (isAnalysisPending) {
    return (
      <Accordion
        defaultExpanded
        sx={{
          mb: 2,
          border: 1,
          borderColor: 'divider',
          borderRadius: 2,
          '&:before': { display: 'none' },
          boxShadow: 'none',
        }}
      >
        <AccordionSummary
          expandIcon={<ChevronDown size={18} />}
          sx={{
            bgcolor: (theme) => theme.palette.mode === 'dark' ? 'grey.900' : 'grey.50',
            borderRadius: 2,
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <CircularProgress size={18} />
            <Box>
              <Typography variant="subtitle2" fontWeight={700}>
                Security Analysis
              </Typography>
              <Typography variant="caption" color="text.secondary">
                Analyzing skill...
              </Typography>
            </Box>
          </Box>
        </AccordionSummary>
        <AccordionDetails>
          <Typography variant="body2" color="text.secondary">
            Please wait while we analyze this skill for security vulnerabilities.
          </Typography>
        </AccordionDetails>
      </Accordion>
    );
  }

  // No analysis yet
  if (!analysis) return null;

  // Error state
  if (analysis.status === 'error') {
    return (
      <Accordion
        defaultExpanded
        sx={{
          mb: 2,
          border: 1,
          borderColor: 'error.main',
          borderRadius: 2,
          '&:before': { display: 'none' },
          boxShadow: 'none',
        }}
      >
        <AccordionSummary
          expandIcon={<ChevronDown size={18} />}
          sx={{
            bgcolor: (theme) =>
              theme.palette.mode === 'dark'
                ? `${theme.palette.error.main}1A`
                : `${theme.palette.error.main}0F`,
            borderRadius: 2,
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <AlertTriangle size={18} />
            <Typography variant="subtitle2" fontWeight={700}>
              Analysis Failed
            </Typography>
          </Box>
        </AccordionSummary>
        <AccordionDetails>
          <Typography variant="body2" color="text.secondary">
            {analysis.vulnerability?.details?.[0] ?? 'Unable to analyze this skill. You may proceed with caution.'}
          </Typography>
        </AccordionDetails>
      </Accordion>
    );
  }

  // Complete analysis
  return (
    <Accordion
      defaultExpanded
      sx={{
        mb: 2,
        border: 1,
        borderColor: (theme) => theme.palette[config.color].main,
        borderRadius: 2,
        '&:before': { display: 'none' },
        boxShadow: 'none',
      }}
    >
      <AccordionSummary
        expandIcon={<ChevronDown size={18} />}
        sx={{
          bgcolor: (theme) =>
            theme.palette.mode === 'dark'
              ? `${theme.palette[config.color].main}1A`
              : `${theme.palette[config.color].main}0F`,
          borderRadius: 2,
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flex: 1 }}>
          <SeverityIcon size={18} />
          <Box sx={{ flex: 1 }}>
            <Typography variant="subtitle2" fontWeight={700}>
              Security Analysis
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {config.label}
            </Typography>
          </Box>
          <Chip
            label={analysis.vulnerability.level.toUpperCase()}
            color={config.color}
            size="small"
            sx={{ fontWeight: 700, fontSize: '0.6875rem', mr: 1 }}
          />
        </Box>
      </AccordionSummary>
      <AccordionDetails>
        {/* Vulnerability details */}
        {analysis.vulnerability.details.map((detail, i) => (
          <Typography key={i} variant="body2" color="text.secondary" sx={{ fontSize: '0.8125rem', mb: 0.25 }}>
            {detail}
          </Typography>
        ))}

        {/* Suggestions */}
        {analysis.vulnerability.suggestions && analysis.vulnerability.suggestions.length > 0 && (
          <Box sx={{ mt: 1.5 }}>
            <Typography variant="caption" fontWeight={600} color="text.secondary" sx={{ display: 'block', mb: 0.5, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Suggestions
            </Typography>
            {analysis.vulnerability.suggestions.map((s, i) => (
              <Typography key={i} variant="body2" color="info.main" sx={{ fontSize: '0.8125rem' }}>
                {s}
              </Typography>
            ))}
          </Box>
        )}

        {/* Commands */}
        {analysis.commands.length > 0 && (
          <Box sx={{ mt: 1.5 }}>
            <Typography variant="caption" fontWeight={600} color="text.secondary" sx={{ display: 'block', mb: 0.5, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Commands ({analysis.commands.length})
            </Typography>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
              {analysis.commands.map((cmd) => (
                <Box
                  key={cmd.name}
                  sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}
                >
                  {cmd.available ? (
                    <CheckCircle size={12} color="var(--mui-palette-success-main, #6CB685)" />
                  ) : (
                    <XCircle size={12} color="var(--mui-palette-error-main, #E1583E)" />
                  )}
                  <Typography variant="caption">{cmd.name}</Typography>
                </Box>
              ))}
            </Box>
          </Box>
        )}
      </AccordionDetails>
    </Accordion>
  );
}

export function MarketplaceSkillDetails({ slug }: MarketplaceSkillDetailsProps) {
  const { data, isLoading } = useMarketplaceSkill(slug);
  const installMutation = useInstallMarketplaceSkill();
  const toggleMutation = useToggleSkill();
  const { data: skillsData } = useSkills();

  const [phase, setPhase] = useState<InstallPhase>('idle');
  const [installResult, setInstallResult] = useState<{
    analysis?: AnalyzeSkillResponse['analysis'];
    logs?: string[];
    error?: string;
  } | null>(null);

  const skill = data?.data;

  // Pre-computed analysis from backend (auto-triggered on view)
  const preAnalysis = skill?.analysis;
  const analysisStatus = skill?.analysisStatus;
  const isAnalysisPending = analysisStatus === 'pending';
  const isCritical = preAnalysis?.vulnerability?.level === 'critical';

  // Check if skill is already installed (active in skills list)
  const isInstalled = skillsData?.data?.some(
    (s) => s.name === slug && s.status === 'active'
  ) ?? skill?.installed;

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

  const { body: cleanReadme, meta: readmeMeta } = parseSkillReadme(skill.readme ?? '');
  const homepage = readmeMeta.homepage;

  const handleInstall = async () => {
    setPhase('installing');
    setInstallResult(null);
    try {
      const result = await installMutation.mutateAsync({ slug: skill.slug });
      setInstallResult({ analysis: result.data.analysis, logs: result.data.logs });
      setPhase('installed');
    } catch (err) {
      setInstallResult({ error: (err as Error).message });
      setPhase('error');
    }
  };

  return (
    <Root>
      <Box sx={{ mb: 3 }}>
        <Typography variant="h5" fontWeight={600}>
          {skill.name}
        </Typography>
        {skill.description && (
          <Typography variant="body2" color="text.secondary" sx={{ whiteSpace: 'pre-wrap', mt: 0.5 }}>
            {skill.description}
          </Typography>
        )}
      </Box>

      <ContentGrid>
        {/* Left: Readme with Analysis Accordion */}
        <ReadmeCard>
          {/* Analysis accordion at the top */}
          <AnalysisAccordion analysis={preAnalysis} isAnalysisPending={isAnalysisPending} />

          {cleanReadme ? (
            <MarkdownViewer content={cleanReadme} />
          ) : (
            <Typography variant="body2" color="text.secondary">
              No readme available.
            </Typography>
          )}
        </ReadmeCard>

        {/* Right: Sidebar */}
        <Sidebar>
          {/* Critical vulnerability block - cannot install */}
          {isCritical && phase === 'idle' && (
            <Alert
              severity="error"
              icon={<Ban size={18} />}
              sx={{ mb: 2, borderRadius: 2 }}
            >
              <Typography variant="body2" fontWeight={600}>
                Installation Blocked
              </Typography>
              <Typography variant="caption" color="text.secondary">
                This skill has critical security vulnerabilities and cannot be installed.
              </Typography>
            </Alert>
          )}

          {/* Uninstall button — when skill is already installed */}
          {phase === 'idle' && isInstalled && (
            <Button
              fullWidth
              variant="outlined"
              color="secondary"
              startIcon={toggleMutation.isPending ? <CircularProgress size={14} /> : <Trash2 size={16} />}
              onClick={() => toggleMutation.mutate(slug)}
              disabled={toggleMutation.isPending}
              sx={{ fontWeight: 600, mb: 1 }}
            >
              {toggleMutation.isPending ? 'Uninstalling...' : 'Uninstall'}
            </Button>
          )}

          {/* Install button — idle state (disabled for critical or already installed) */}
          {phase === 'idle' && !isInstalled && (
            <Button
              fullWidth
              variant="contained"
              startIcon={isCritical ? <Ban size={16} /> : <Download size={16} />}
              onClick={handleInstall}
              disabled={isCritical || isAnalysisPending}
              sx={{ fontWeight: 600 }}
            >
              {isCritical ? 'Cannot Install' : isAnalysisPending ? 'Waiting for analysis...' : 'Install'}
            </Button>
          )}

          {/* Installing state */}
          {phase === 'installing' && (
            <Button
              fullWidth
              variant="contained"
              startIcon={<CircularProgress size={14} />}
              disabled
              sx={{ fontWeight: 600 }}
            >
              Installing...
            </Button>
          )}

          {/* Installed success */}
          {phase === 'installed' && (
            <>
              <Box
                sx={{
                  borderRadius: 2,
                  overflow: 'hidden',
                  border: 1,
                  borderColor: (theme) => theme.palette.success.main,
                }}
              >
                <Box
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1,
                    px: 2,
                    py: 1.5,
                    bgcolor: (theme) =>
                      theme.palette.mode === 'dark'
                        ? `${theme.palette.success.main}1A`
                        : `${theme.palette.success.main}0F`,
                  }}
                >
                  <CheckCircle size={18} />
                  <Box>
                    <Typography variant="subtitle2" fontWeight={700}>
                      Installed
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      Skill is now active.
                    </Typography>
                  </Box>
                </Box>

                {/* Logs */}
                {installResult?.logs && installResult.logs.length > 0 && (
                  <Box sx={{ px: 2, py: 1.5 }}>
                    {installResult.logs.map((log, i) => (
                      <Typography key={i} variant="caption" color="text.secondary" sx={{ display: 'block', fontSize: '0.75rem' }}>
                        {log}
                      </Typography>
                    ))}
                  </Box>
                )}
              </Box>
            </>
          )}

          {/* Error state */}
          {phase === 'error' && (
            <Box
              sx={{
                borderRadius: 2,
                overflow: 'hidden',
                border: 1,
                borderColor: (theme) => theme.palette.error.main,
              }}
            >
              <Box
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1,
                  px: 2,
                  py: 1.5,
                  bgcolor: (theme) =>
                    theme.palette.mode === 'dark'
                      ? `${theme.palette.error.main}1A`
                      : `${theme.palette.error.main}0F`,
                }}
              >
                <ShieldAlert size={18} />
                <Typography variant="subtitle2" fontWeight={700}>
                  Installation Failed
                </Typography>
              </Box>
              <Box sx={{ px: 2, py: 1.5 }}>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5, fontSize: '0.8125rem' }}>
                  {installResult?.error ?? 'An unexpected error occurred.'}
                </Typography>
                <Button
                  fullWidth
                  variant="outlined"
                  color="secondary"
                  startIcon={<RefreshCw size={14} />}
                  onClick={handleInstall}
                  sx={{ fontWeight: 600 }}
                >
                  Retry Install
                </Button>
              </Box>
            </Box>
          )}

          {/* About section */}
          <SidebarSection>
            <Typography variant="overline" color="text.secondary" sx={{ fontWeight: 700, letterSpacing: '0.08em' }}>
              About
            </Typography>
            <MetaItem icon={User} label={skill.author} />
            <MetaItem icon={Tag} label={`v${skill.version}`} />
            <MetaItem icon={Download} label={`${skill.installs.toLocaleString()} installs`} />
            {homepage && (
              <MetaItem
                icon={ExternalLink}
                label={(() => { try { return new URL(homepage).hostname; } catch { return homepage; } })()}
                href={homepage}
              />
            )}
          </SidebarSection>

          {/* Tags */}
          {skill.tags.length > 0 && (
            <SidebarSection>
              <Typography variant="overline" color="text.secondary" sx={{ fontWeight: 700, letterSpacing: '0.08em' }}>
                Tags
              </Typography>
              <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                {skill.tags.map((tag) => (
                  <Chip key={tag} label={tag} size="small" variant="outlined" />
                ))}
              </Box>
            </SidebarSection>
          )}
        </Sidebar>
      </ContentGrid>
    </Root>
  );
}
