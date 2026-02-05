import { useState } from 'react';
import { Typography, Button, Skeleton, Box, Chip, CircularProgress, Alert } from '@mui/material';
import { ShieldCheck, Download, RefreshCw } from 'lucide-react';
import { useMarketplaceSkill, useAnalyzeMarketplaceSkill, useInstallMarketplaceSkill } from '../../../api/hooks';
import type { AnalyzeSkillResponse } from '../../../api/marketplace.types';
import { MarkdownViewer } from '../../shared/MarkdownViewer';
import { Root, Header, Actions, MetaRow } from '../SkillDetails/SkillDetails.styles';

type InstallPhase = 'idle' | 'analyzing' | 'analyzed' | 'analysis_failed' | 'installing' | 'installed';

interface MarketplaceSkillDetailsProps {
  slug: string;
}

const alertSeverity: Record<string, 'success' | 'info' | 'warning' | 'error'> = {
  safe: 'success',
  low: 'info',
  medium: 'warning',
  high: 'warning',
  critical: 'error',
};

export function MarketplaceSkillDetails({ slug }: MarketplaceSkillDetailsProps) {
  const { data, isLoading } = useMarketplaceSkill(slug);
  const analyzeMutation = useAnalyzeMarketplaceSkill();
  const installMutation = useInstallMarketplaceSkill();

  const [phase, setPhase] = useState<InstallPhase>('idle');
  const [analysis, setAnalysis] = useState<AnalyzeSkillResponse['analysis'] | null>(null);

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

  const handleAnalyze = async () => {
    if (!skill.files?.length) return;
    setPhase('analyzing');
    try {
      const result = await analyzeMutation.mutateAsync({ files: skill.files });
      setAnalysis(result.data.analysis);
      setPhase('analyzed');
    } catch {
      setPhase('analysis_failed');
    }
  };

  const handleInstall = async () => {
    if (!skill.files?.length || !analysis) return;
    setPhase('installing');
    try {
      await installMutation.mutateAsync({ slug: skill.slug, files: skill.files, analysis });
      setPhase('installed');
    } catch {
      setPhase('analyzed');
    }
  };

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
        <Chip label="Marketplace" size="small" color="primary" variant="outlined" />
      </Header>

      <MetaRow>
        <Typography variant="caption" color="text.secondary">
          Author: {skill.author}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          Version: {skill.version}
        </Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <Download size={12} />
          <Typography variant="caption" color="text.secondary">
            {skill.installs.toLocaleString()} installs
          </Typography>
        </Box>
      </MetaRow>

      {skill.tags.length > 0 && (
        <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', mb: 2 }}>
          {skill.tags.map((tag) => (
            <Chip key={tag} label={tag} size="small" variant="outlined" />
          ))}
        </Box>
      )}

      <Actions>
        {phase === 'idle' && (
          <Button
            size="small"
            variant="contained"
            startIcon={<ShieldCheck size={16} />}
            onClick={handleAnalyze}
            disabled={!skill.files?.length}
          >
            Analyze & Install
          </Button>
        )}

        {phase === 'analyzing' && (
          <Button size="small" variant="contained" disabled startIcon={<CircularProgress size={14} />}>
            Analyzing...
          </Button>
        )}

        {phase === 'analyzed' && analysis && (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, width: '100%' }}>
            <Alert
              severity={alertSeverity[analysis.vulnerability.level] ?? 'info'}
            >
              <Typography variant="body2" fontWeight={500}>
                Vulnerability: {analysis.vulnerability.level}
              </Typography>
              {analysis.vulnerability.details.map((detail, i) => (
                <Typography key={i} variant="caption" sx={{ display: 'block' }}>
                  {detail}
                </Typography>
              ))}
            </Alert>
            <Button
              size="small"
              variant="contained"
              startIcon={<Download size={16} />}
              onClick={handleInstall}
              disabled={analysis.vulnerability.level === 'critical'}
            >
              Install Skill
            </Button>
          </Box>
        )}

        {phase === 'installing' && (
          <Button size="small" variant="contained" disabled startIcon={<CircularProgress size={14} />}>
            Installing...
          </Button>
        )}

        {phase === 'installed' && (
          <Alert severity="success" sx={{ width: '100%' }}>
            Skill installed successfully! It will appear in the Active tab once approved.
          </Alert>
        )}

        {phase === 'analysis_failed' && (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, width: '100%' }}>
            <Alert severity="error">
              Analysis failed. The skill could not be analyzed at this time.
            </Alert>
            <Button
              size="small"
              variant="outlined"
              color="secondary"
              startIcon={<RefreshCw size={14} />}
              onClick={handleAnalyze}
            >
              Retry
            </Button>
          </Box>
        )}
      </Actions>

      {skill.readme && (
        <Box sx={{ mt: 3, flex: 1, overflow: 'auto' }}>
          <MarkdownViewer content={skill.readme} />
        </Box>
      )}
    </Root>
  );
}
