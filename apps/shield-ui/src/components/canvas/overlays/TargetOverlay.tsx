/**
 * TargetOverlay — full-screen tabbed profile view for a specific target.
 *
 * Rendered when the URL matches /target/<id>/<tab>.
 * Manages scope (profile ID) so all scope-aware hooks return target-filtered data.
 * Reuses PageOverlay styled components and lazy-loads existing page components.
 */

import { lazy, Suspense, useState, useCallback, useEffect, useRef, useMemo, memo } from 'react';
import { useTheme } from '@mui/material/styles';
import { Tabs, Tab, Chip, Box, Button } from '@mui/material';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  ArrowLeft,
  Eye, Activity, Terminal, Zap, KeyRound, Settings,
} from 'lucide-react';
import { formatAgentUsername } from '../../../utils/eventDisplay';
import { useSnapshot } from 'valtio';
import { CircularLoader } from '../../../elements';
import { setSkipEntryAnimation } from '../../../state/canvas-drilldown';
import {
  OverlayRoot,
  ContentPanel,
  OverlayHeader,
  ScrollArea,
  FullHeightArea,
} from './PageOverlay.styles';
import { setScope, clearScope } from '../../../state/scope';
import { setupPanelStore } from '../../../state/setup-panel';
import { useProfiles } from '../../../api/hooks';
import { useTargets } from '../../../api/targets';


/* ---- Tab config ---- */

const TARGET_TABS = [
  { slug: 'overview', label: 'Overview', icon: Eye },
  { slug: 'activity', label: 'Activity', icon: Activity },
  { slug: 'skills', label: 'Skills', icon: Zap },
  { slug: 'policies', label: 'Policies', icon: Terminal },
  { slug: 'secrets', label: 'Secrets', icon: KeyRound },
  { slug: 'settings', label: 'Settings', icon: Settings },
] as const;

/* ---- Lazy-loaded page components ---- */

const LazyTargetOverview = lazy(() => import('../../../pages/TargetOverview').then(m => ({ default: m.TargetOverview })));
const LazyActivity = lazy(() => import('../../../pages/Activity').then(m => ({ default: m.Activity })));
const LazyPolicies = lazy(() => import('../../../pages/Policies').then(m => ({ default: m.Policies })));
const LazySecrets = lazy(() => import('../../../pages/Secrets').then(m => ({ default: m.Secrets })));
const LazySkills = lazy(() => import('../../../pages/Skills').then(m => ({ default: m.Skills })));
const LazySettings = lazy(() => import('../../../pages/Settings').then(m => ({ default: m.Settings })));
const LazySkillPage = lazy(() => import('../../../pages/SkillPage').then(m => ({ default: m.SkillPage })));

/* ---- TargetOverlay ---- */

interface TargetOverlayProps {
  targetId: string;
  tab?: string;
  phase?: string;
  skipAnimation?: boolean;
}

export const TargetOverlay = memo(({ targetId, tab, skipAnimation }: TargetOverlayProps) => {
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';
  const navigate = useNavigate();
  const location = useLocation();
  // Resolve target info from lifecycle API (SSE-driven)
  const { data: targetsData } = useTargets();
  const { data: profilesData } = useProfiles();
  const shieldProgressSnap = useSnapshot(setupPanelStore).shieldProgress;

  const targetInfo = useMemo(() => {
    const targets = targetsData?.data;
    if (!targets) return undefined;
    // Exact match first
    const exact = targets.find(t => t.id === targetId);
    if (exact) return exact;
    // Fallback: resolve via shieldProgress profileId (handles pre-shield ID navigation)
    const progress = shieldProgressSnap[targetId];
    if (progress?.profileId) {
      return targets.find(t => t.id === progress.profileId);
    }
    return undefined;
  }, [targetsData, targetId, shieldProgressSnap]);

  // Resolve profile ID for scope management

  const profileId = useMemo(() => {
    // 1. Check shield progress (set during shield operation)
    const progress = shieldProgressSnap[targetId];
    if (progress?.profileId) return progress.profileId;

    // 2. Fall back to matching from profiles list
    const profiles = profilesData?.data;
    if (!profiles || !Array.isArray(profiles)) return null;

    // Match by targetName or profile id containing the targetId
    const match = (profiles as Array<{ id: string; targetName?: string }>).find(
      p => p.targetName === targetId || p.id === targetId || p.id.includes(targetId),
    );
    return match?.id ?? null;
  }, [shieldProgressSnap, targetId, profilesData]);

  // Set scope on mount, clear on unmount
  useEffect(() => {
    if (profileId) {
      setScope(profileId);
    }
    return () => {
      clearScope();
    };
  }, [profileId]);

  // Clear skip-animation flag after first paint so subsequent navigations animate normally
  const skipClearedRef = useRef(false);
  useEffect(() => {
    if (skipAnimation && !skipClearedRef.current) {
      skipClearedRef.current = true;
      requestAnimationFrame(() => setSkipEntryAnimation(false));
    }
  }, [skipAnimation]);

  // Escape key closes overlay
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') navigate('/');
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [navigate]);

  const handleBack = useCallback(() => {
    navigate('/');
  }, [navigate]);

  const activeTab = tab || 'overview';
  const tabIdx = Math.max(0, TARGET_TABS.findIndex(t => t.slug === activeTab));

  // Track embedded policy sub-tab locally so Policies doesn't use relative navigate()
  const [policiesTab, setPoliciesTab] = useState('commands');

  // Track inline skill detail within skills tab
  const [selectedSkillId, setSelectedSkillId] = useState<string | null>(null);

  const handleTabChange = useCallback((_: React.SyntheticEvent, newIdx: number) => {
    setSelectedSkillId(null); // Reset inline skill detail on tab switch
    navigate(`/target/${targetId}/${TARGET_TABS[newIdx].slug}`, { replace: true });
  }, [navigate, targetId]);

  const rawName = targetInfo?.name ?? targetId;
  const targetName = formatAgentUsername(rawName);
  const isShielded = targetInfo?.shielded ?? false;

  const fallback = (
    <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}>
      <CircularLoader />
    </div>
  );

  return (
    <OverlayRoot>
      <ContentPanel $isDark={isDark} $skipAnimation={skipAnimation}>
        <OverlayHeader $isDark={isDark}>
          {/* Back button */}
          <button
            onClick={handleBack}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 32,
              height: 32,
              borderRadius: 8,
              border: `1px solid ${isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.12)'}`,
              backgroundColor: 'transparent',
              color: theme.palette.text.secondary,
              cursor: 'pointer',
              padding: 0,
              flexShrink: 0,
            }}
          >
            <ArrowLeft size={16} />
          </button>

          {/* Target name */}
          <span style={{
            fontSize: 16,
            fontWeight: 700,
            fontFamily: "'Manrope', sans-serif",
            color: theme.palette.text.primary,
          }}>
            {targetName}
          </span>

          {/* Status chip */}
          <Chip
            label={isShielded ? 'Shielded' : 'Running'}
            size="small"
            sx={{
              height: 22,
              fontSize: 11,
              fontWeight: 600,
              bgcolor: isShielded
                ? (isDark ? 'rgba(61,160,90,0.15)' : 'rgba(61,160,90,0.1)')
                : (isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)'),
              color: isShielded
                ? '#3DA05A'
                : theme.palette.text.secondary,
              borderRadius: '6px',
            }}
          />

          {/* Tabs */}
          <Tabs
            value={tabIdx}
            onChange={handleTabChange}
            sx={{ ml: 'auto', minHeight: 36 }}
          >
            {TARGET_TABS.map((t) => {
              const TabIcon = t.icon;
              return (
                <Tab
                  key={t.slug}
                  icon={<TabIcon size={13} />}
                  iconPosition="start"
                  label={t.label}
                  sx={{ minHeight: 36, textTransform: 'none', fontSize: 13, py: 0 }}
                />
              );
            })}
          </Tabs>
        </OverlayHeader>

        {activeTab === 'overview' ? (
          <ScrollArea>
            <Suspense fallback={fallback}>
              <LazyTargetOverview targetId={targetId} targetInfo={targetInfo} profileId={profileId} />
            </Suspense>
          </ScrollArea>
        ) : activeTab === 'activity' ? (
          <FullHeightArea>
            <Suspense fallback={fallback}>
              <LazyActivity embedded fillHeight showDetailPanel sourceFilter={targetId} profileId={profileId ?? undefined} />
            </Suspense>
          </FullHeightArea>
        ) : (
          <ScrollArea>
            <Suspense fallback={fallback}>
              {activeTab === 'skills' && (
                selectedSkillId ? (
                  <Box>
                    <Button
                      size="small"
                      variant="text"
                      color="secondary"
                      startIcon={<ArrowLeft size={16} />}
                      onClick={() => setSelectedSkillId(null)}
                      sx={{ mb: 2 }}
                    >
                      Back to Skills
                    </Button>
                    <LazySkillPage skillId={selectedSkillId} embedded targetId={targetId} />
                  </Box>
                ) : (
                  <LazySkills embedded targetId={targetId} onSkillClick={setSelectedSkillId} />
                )
              )}
              {activeTab === 'policies' && <LazyPolicies embedded embeddedTab={policiesTab} />}
              {activeTab === 'secrets' && <LazySecrets embedded />}
              {activeTab === 'settings' && <LazySettings embedded profileId={profileId} targetId={targetId} />}
            </Suspense>
          </ScrollArea>
        )}
      </ContentPanel>
    </OverlayRoot>
  );
});
TargetOverlay.displayName = 'TargetOverlay';
