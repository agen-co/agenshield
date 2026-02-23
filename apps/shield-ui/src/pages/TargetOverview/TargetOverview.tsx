/**
 * TargetOverview — dedicated home page for a target application.
 *
 * Shows app header with controls, recent activity, top commands/endpoints,
 * app info, quick stats, and optional OpenClaw card.
 */

import { lazy, Suspense, useCallback } from 'react';
import {
  Box,
  Card,
  Chip,
  Typography,
} from '@mui/material';
import {
  Play,
  Square,
  ShieldCheck,
  KeyRound,
  Zap,
  Terminal,
  Info,
  ExternalLink,
} from 'lucide-react';
import { useProfiles, useOpenClawStatus, useOpenClawDashboardUrl, useConfig, useSecrets, useSkills } from '../../api/hooks';
import { useStartTarget, useStopTarget } from '../../api/targets';
import { useTargetStats } from '../../hooks/useTargetStats';
import { getBrandIcon, getTargetIcon } from '../../utils/targetBranding';
import { CircularLoader } from '../../elements';
import PrimaryButton from '../../elements/buttons/PrimaryButton';
import DangerButton from '../../elements/buttons/DangerButton';
import SecondaryButton from '../../elements/buttons/SecondaryButton';
import { PageGrid, HeaderCard, InfoRow, StatRow } from './TargetOverview.styles';
import type { TargetOverviewProps } from './TargetOverview.types';

const LazyActivity = lazy(() => import('../Activity').then(m => ({ default: m.Activity })));

export function TargetOverview({ targetId, targetInfo, profileId }: TargetOverviewProps) {
  const startTarget = useStartTarget();
  const stopTarget = useStopTarget();
  const stats = useTargetStats(targetId);
  const { data: profilesData } = useProfiles();
  const { data: openClawData } = useOpenClawStatus();
  const openClawDashboard = useOpenClawDashboardUrl();
  const { data: configData } = useConfig();
  const { data: secretsData } = useSecrets();
  const { data: skillsData } = useSkills();

  const isOpenClaw = targetInfo?.type === 'openclaw';
  const isRunning = targetInfo?.running ?? false;
  const isShielded = targetInfo?.shielded ?? false;
  const brandIcon = targetInfo ? getBrandIcon(targetInfo.type) : null;
  const TargetIcon = targetInfo ? getTargetIcon(targetInfo.type) : Terminal;

  // Resolve agent username from profile
  const profile = profilesData?.data?.find(
    (p: { id: string; targetName?: string }) =>
      p.id === profileId || p.targetName === targetId,
  );
  const agentUsername = (profile as Record<string, unknown> | undefined)?.agentUsername as string | undefined;

  // Counts from scoped queries
  const policiesCount = (configData?.data as Record<string, unknown> | undefined)?.policies;
  const policiesArray = Array.isArray(policiesCount) ? policiesCount.length : 0;
  const secretsCount = Array.isArray(secretsData?.data) ? secretsData.data.length : 0;
  const skillsCount = Array.isArray(skillsData?.data) ? skillsData.data.length : 0;

  const handleStart = useCallback(() => {
    startTarget.mutate(targetId);
  }, [startTarget, targetId]);

  const handleStop = useCallback(() => {
    stopTarget.mutate(targetId);
  }, [stopTarget, targetId]);

  const handleOpenDashboard = useCallback(() => {
    openClawDashboard.mutate(undefined, {
      onSuccess: (data) => {
        const url = data?.data?.url;
        if (url) window.open(url, '_blank');
      },
    });
  }, [openClawDashboard]);

  const gateway = openClawData?.data?.gateway;

  return (
    <PageGrid>
      {/* ---- Left Column ---- */}
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
        {/* App Header */}
        <HeaderCard>
          {brandIcon ? (
            <img src={brandIcon} alt={targetInfo?.name ?? ''} style={{ width: 40, height: 40 }} />
          ) : (
            <Box sx={{ width: 40, height: 40, display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: 'action.hover', borderRadius: 1.5 }}>
              <TargetIcon size={24} />
            </Box>
          )}
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Typography variant="h5" fontWeight={700} noWrap>
                {targetInfo?.name ?? targetId}
              </Typography>
              <Chip
                label={isShielded ? 'Shielded' : isRunning ? 'Running' : 'Stopped'}
                size="small"
                color={isShielded ? 'success' : isRunning ? 'default' : 'error'}
                variant="outlined"
                sx={{ height: 22, fontSize: 11 }}
              />
            </Box>
            {agentUsername && (
              <Typography variant="body2" color="text.secondary">
                {agentUsername}
              </Typography>
            )}
          </Box>
          <Box sx={{ display: 'flex', gap: 1, flexShrink: 0 }}>
            <PrimaryButton
              size="small"
              startIcon={<Play size={14} />}
              onClick={handleStart}
              disabled={isRunning || startTarget.isPending}
            >
              Start
            </PrimaryButton>
            <DangerButton
              size="small"
              startIcon={<Square size={14} />}
              onClick={handleStop}
              disabled={!isRunning || stopTarget.isPending}
            >
              Stop
            </DangerButton>
          </Box>
        </HeaderCard>

        {/* Recent Activity */}
        <Card>
          <Typography variant="subtitle1" fontWeight={600} sx={{ mb: 1.5 }}>
            Recent Activity
          </Typography>
          <Box sx={{ height: 320, overflow: 'hidden' }}>
            <Suspense fallback={<Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}><CircularLoader /></Box>}>
              <LazyActivity embedded sourceFilter={targetId} fillHeight />
            </Suspense>
          </Box>
        </Card>

        {/* Top Commands & Endpoints */}
        <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
          <Card>
            <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 1 }}>
              Top Commands
            </Typography>
            {stats.topCommands.length === 0 ? (
              <Typography variant="body2" color="text.secondary">No command data yet</Typography>
            ) : (
              stats.topCommands.map((cmd, i) => (
                <StatRow key={cmd.command}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
                    <Typography variant="caption" color="text.secondary" sx={{ width: 16, textAlign: 'right' }}>
                      {i + 1}.
                    </Typography>
                    <Typography variant="body2" noWrap sx={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 12 }}>
                      {cmd.command}
                    </Typography>
                  </Box>
                  <Chip label={cmd.count} size="small" sx={{ height: 20, fontSize: 11 }} />
                </StatRow>
              ))
            )}
          </Card>

          <Card>
            <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 1 }}>
              Top Endpoints
            </Typography>
            {stats.topEndpoints.length === 0 ? (
              <Typography variant="body2" color="text.secondary">No network data yet</Typography>
            ) : (
              stats.topEndpoints.map((ep, i) => (
                <StatRow key={ep.endpoint}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
                    <Typography variant="caption" color="text.secondary" sx={{ width: 16, textAlign: 'right' }}>
                      {i + 1}.
                    </Typography>
                    <Typography variant="body2" noWrap sx={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 12 }}>
                      {ep.endpoint}
                    </Typography>
                  </Box>
                  <Chip label={ep.count} size="small" sx={{ height: 20, fontSize: 11 }} />
                </StatRow>
              ))
            )}
          </Card>
        </Box>
      </Box>

      {/* ---- Right Column ---- */}
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
        {/* App Info */}
        <Card>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
            <Info size={16} />
            <Typography variant="subtitle1" fontWeight={600}>App Info</Typography>
          </Box>
          <InfoRow>
            <Typography variant="body2" color="text.secondary">Type</Typography>
            <Typography variant="body2" fontWeight={500}>{targetInfo?.type ?? 'Unknown'}</Typography>
          </InfoRow>
          {targetInfo?.version && (
            <InfoRow>
              <Typography variant="body2" color="text.secondary">Version</Typography>
              <Typography variant="body2" fontWeight={500}>{targetInfo.version}</Typography>
            </InfoRow>
          )}
          {targetInfo?.binaryPath && (
            <InfoRow>
              <Typography variant="body2" color="text.secondary">Binary</Typography>
              <Typography variant="body2" fontWeight={500} noWrap sx={{ maxWidth: 200, fontFamily: "'IBM Plex Mono', monospace", fontSize: 12 }}>
                {targetInfo.binaryPath}
              </Typography>
            </InfoRow>
          )}
          {stats.lastPid && (
            <InfoRow>
              <Typography variant="body2" color="text.secondary">PID</Typography>
              <Typography variant="body2" fontWeight={500}>{stats.lastPid}</Typography>
            </InfoRow>
          )}
          {agentUsername && (
            <InfoRow>
              <Typography variant="body2" color="text.secondary">Agent User</Typography>
              <Typography variant="body2" fontWeight={500}>{agentUsername}</Typography>
            </InfoRow>
          )}
        </Card>

        {/* Quick Stats */}
        <Card>
          <Typography variant="subtitle1" fontWeight={600} sx={{ mb: 1.5 }}>Quick Stats</Typography>
          <InfoRow>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <ShieldCheck size={14} />
              <Typography variant="body2">Policies</Typography>
            </Box>
            <Chip label={policiesArray} size="small" sx={{ height: 22 }} />
          </InfoRow>
          <InfoRow>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <KeyRound size={14} />
              <Typography variant="body2">Secrets</Typography>
            </Box>
            <Chip label={secretsCount} size="small" sx={{ height: 22 }} />
          </InfoRow>
          <InfoRow>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Zap size={14} />
              <Typography variant="body2">Skills</Typography>
            </Box>
            <Chip label={skillsCount} size="small" sx={{ height: 22 }} />
          </InfoRow>
          <InfoRow>
            <Typography variant="body2" color="text.secondary">Events</Typography>
            <Typography variant="body2" fontWeight={500}>{stats.totalEvents}</Typography>
          </InfoRow>
          <InfoRow>
            <Typography variant="body2" color="text.secondary">Blocked</Typography>
            <Typography variant="body2" fontWeight={500} color="error.main">{stats.blockedCount}</Typography>
          </InfoRow>
        </Card>

        {/* OpenClaw Card (only for openclaw targets) */}
        {isOpenClaw && (
          <Card>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
              <Typography variant="subtitle1" fontWeight={600}>OpenClaw</Typography>
              {gateway && (
                <Chip
                  label={gateway.running ? 'Running' : 'Stopped'}
                  color={gateway.running ? 'success' : 'error'}
                  size="small"
                  variant="outlined"
                />
              )}
            </Box>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              OpenClaw gateway service status
              {gateway?.running && gateway?.pid != null && ` (PID: ${gateway.pid})`}
            </Typography>
            <SecondaryButton
              size="small"
              startIcon={<ExternalLink size={14} />}
              onClick={handleOpenDashboard}
              disabled={openClawDashboard.isPending}
              fullWidth
            >
              Open Dashboard
            </SecondaryButton>
          </Card>
        )}
      </Box>
    </PageGrid>
  );
}
