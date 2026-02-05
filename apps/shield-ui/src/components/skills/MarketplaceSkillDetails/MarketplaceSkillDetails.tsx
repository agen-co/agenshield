import { useState, useEffect } from 'react';
import { Typography, Button, Skeleton, Box, Chip, CircularProgress, Divider } from '@mui/material';
import { ShieldCheck, Download, RefreshCw, User, Tag, ExternalLink, CheckCircle, XCircle, ShieldAlert, AlertTriangle } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useMarketplaceSkill, useAnalyzeMarketplaceSkill, useInstallMarketplaceSkill, useCachedAnalysis, queryKeys } from '../../../api/hooks';
import type { AnalyzeSkillResponse } from '../../../api/marketplace.types';
import { MarkdownViewer } from '../../shared/MarkdownViewer';
import { parseSkillReadme } from '../../../utils/parseSkillReadme';
import { Root, ContentGrid, ReadmeCard, Sidebar, SidebarSection } from '../SkillDetails/SkillDetails.styles';

type InstallPhase = 'idle' | 'analyzing' | 'analyzed' | 'analysis_failed' | 'installing' | 'installed';

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

function AnalysisResultCard({
  analysis,
  phase,
  onInstall,
}: {
  analysis: AnalyzeSkillResponse['analysis'];
  phase: InstallPhase;
  onInstall: () => void;
}) {
  const config = severityConfig[analysis.vulnerability.level] ?? severityConfig.safe;
  const SeverityIcon = config.icon;
  const isCritical = analysis.vulnerability.level === 'critical';
  const isInstalling = phase === 'installing';

  return (
    <Box
      sx={{
        borderRadius: 2,
        overflow: 'hidden',
        border: 1,
        borderColor: (theme) => theme.palette[config.color].main,
      }}
    >
      {/* Header */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          px: 2,
          py: 1.5,
          bgcolor: (theme) =>
            theme.palette.mode === 'dark'
              ? `${theme.palette[config.color].main}1A`
              : `${theme.palette[config.color].main}0F`,
        }}
      >
        <SeverityIcon size={18} />
        <Box sx={{ flex: 1 }}>
          <Typography variant="subtitle2" fontWeight={700}>
            {config.label}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            Security Analysis
          </Typography>
        </Box>
        <Chip
          label={analysis.vulnerability.level.toUpperCase()}
          color={config.color}
          size="small"
          sx={{ fontWeight: 700, fontSize: '0.6875rem' }}
        />
      </Box>

      {/* Details */}
      <Box sx={{ px: 2, py: 1.5 }}>
        {analysis.vulnerability.details.map((detail, i) => (
          <Typography key={i} variant="body2" color="text.secondary" sx={{ fontSize: '0.8125rem', mb: 0.25 }}>
            {detail}
          </Typography>
        ))}

        {analysis.vulnerability.suggestions && analysis.vulnerability.suggestions.length > 0 && (
          <Box sx={{ mt: 1 }}>
            {analysis.vulnerability.suggestions.map((s, i) => (
              <Typography key={i} variant="body2" color="info.main" sx={{ fontSize: '0.8125rem' }}>
                {s}
              </Typography>
            ))}
          </Box>
        )}

        {/* Commands */}
        {analysis.commands.length > 0 && (
          <>
            <Divider sx={{ my: 1.5 }} />
            <Typography variant="caption" fontWeight={600} color="text.secondary" sx={{ display: 'block', mb: 0.5, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Commands ({analysis.commands.length})
            </Typography>
            {analysis.commands.map((cmd) => (
              <Box
                key={cmd.name}
                sx={{ display: 'flex', alignItems: 'center', gap: 0.5, py: 0.25 }}
              >
                {cmd.available ? (
                  <CheckCircle size={12} color="var(--mui-palette-success-main, #6CB685)" />
                ) : (
                  <XCircle size={12} color="var(--mui-palette-error-main, #E1583E)" />
                )}
                <Typography variant="caption">{cmd.name}</Typography>
              </Box>
            ))}
          </>
        )}

        {/* Install button inside the card */}
        <Divider sx={{ my: 1.5 }} />
        <Button
          fullWidth
          variant="contained"
          color={isCritical ? 'error' : 'primary'}
          startIcon={isInstalling ? <CircularProgress size={14} /> : <Download size={16} />}
          onClick={onInstall}
          disabled={isCritical || isInstalling}
          sx={{ fontWeight: 600 }}
        >
          {isCritical ? 'Cannot Install (Critical)' : isInstalling ? 'Installing...' : 'Install Skill'}
        </Button>
      </Box>
    </Box>
  );
}

export function MarketplaceSkillDetails({ slug }: MarketplaceSkillDetailsProps) {
  const { data, isLoading } = useMarketplaceSkill(slug);
  const analyzeMutation = useAnalyzeMarketplaceSkill();
  const installMutation = useInstallMarketplaceSkill();
  const queryClient = useQueryClient();

  const [phase, setPhase] = useState<InstallPhase>('idle');
  const [analysis, setAnalysis] = useState<AnalyzeSkillResponse['analysis'] | null>(null);

  const skill = data?.data;
  const cachedAnalysisQuery = useCachedAnalysis(skill?.name ?? null, skill?.author ?? null);

  // Pre-populate from cached marketplace analysis
  useEffect(() => {
    if (phase === 'idle' && cachedAnalysisQuery.data?.data?.analysis) {
      setAnalysis(cachedAnalysisQuery.data.data.analysis);
      setPhase('analyzed');
    }
  }, [cachedAnalysisQuery.data, phase]);

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

  const handleAnalyze = async () => {
    if (!skill.files?.length) return;
    setPhase('analyzing');
    try {
      const result = await analyzeMutation.mutateAsync({
        skillName: skill.name,
        publisher: skill.author,
        files: skill.files,
      });
      setAnalysis(result.data.analysis);
      setPhase('analyzed');
      // Update cached analysis query
      queryClient.setQueryData(
        queryKeys.marketplaceCachedAnalysis(skill.name, skill.author),
        result
      );
    } catch {
      setPhase('analysis_failed');
    }
  };

  const handleInstall = async () => {
    if (!skill.files?.length || !analysis) return;
    setPhase('installing');
    try {
      await installMutation.mutateAsync({
        slug: skill.slug,
        files: skill.files,
        analysis,
        publisher: skill.author,
      });
      setPhase('installed');
    } catch {
      setPhase('analyzed');
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
        {/* Left: Readme */}
        <ReadmeCard>
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
          {/* Analyze button — shown before analysis */}
          {(phase === 'idle' || phase === 'analyzing') && (
            <Button
              fullWidth
              variant="contained"
              startIcon={
                phase === 'idle'
                  ? <ShieldCheck size={16} />
                  : <CircularProgress size={14} />
              }
              onClick={handleAnalyze}
              disabled={phase !== 'idle' || !skill.files?.length}
              sx={{ fontWeight: 600 }}
            >
              {phase === 'idle' ? 'Analyze & Install' : 'Analyzing...'}
            </Button>
          )}

          {/* Analysis result card with Install button inside */}
          {(phase === 'analyzed' || phase === 'installing') && analysis && (
            <AnalysisResultCard analysis={analysis} phase={phase} onInstall={handleInstall} />
          )}

          {/* Installed success */}
          {phase === 'installed' && (
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
                    Skill will appear in the Active tab once approved.
                  </Typography>
                </Box>
              </Box>
            </Box>
          )}

          {/* Analysis failed */}
          {phase === 'analysis_failed' && (
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
                  Analysis Failed
                </Typography>
              </Box>
              <Box sx={{ px: 2, py: 1.5 }}>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5, fontSize: '0.8125rem' }}>
                  The skill could not be analyzed at this time.
                </Typography>
                <Button
                  fullWidth
                  variant="outlined"
                  color="secondary"
                  startIcon={<RefreshCw size={14} />}
                  onClick={handleAnalyze}
                  sx={{ fontWeight: 600 }}
                >
                  Retry Analysis
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
