/**
 * TargetOverlay — full-screen tabbed profile view for a specific target.
 *
 * Rendered when the URL matches /target/<id>/<tab>.
 * Manages scope (profile ID) so all scope-aware hooks return target-filtered data.
 * Reuses PageOverlay styled components and lazy-loads existing page components.
 */

import { lazy, Suspense, useCallback, useEffect, useMemo, memo } from 'react';
import { useTheme } from '@mui/material/styles';
import { Tabs, Tab, Chip } from '@mui/material';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  ArrowLeft,
  Eye, Activity, Terminal, KeyRound, Settings,
} from 'lucide-react';
import { useSnapshot } from 'valtio';
import { CircularLoader } from '../../../elements';
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
  { slug: 'policies', label: 'Policies', icon: Terminal },
  { slug: 'secrets', label: 'Secrets', icon: KeyRound },
  { slug: 'settings', label: 'Settings', icon: Settings },
] as const;

/* ---- Lazy-loaded page components ---- */

const LazyOverview = lazy(() => import('../../../pages/Overview').then(m => ({ default: m.Overview })));
const LazyActivity = lazy(() => import('../../../pages/Activity').then(m => ({ default: m.Activity })));
const LazyPolicies = lazy(() => import('../../../pages/Policies').then(m => ({ default: m.Policies })));
const LazySecrets = lazy(() => import('../../../pages/Secrets').then(m => ({ default: m.Secrets })));
const LazySettings = lazy(() => import('../../../pages/Settings').then(m => ({ default: m.Settings })));

/* ---- TargetOverlay ---- */

interface TargetOverlayProps {
  targetId: string;
  tab?: string;
  phase?: string;
}

export const TargetOverlay = memo(({ targetId, tab }: TargetOverlayProps) => {
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';
  const navigate = useNavigate();
  const location = useLocation();

  // Resolve target info from lifecycle API
  const { data: targetsData } = useTargets();
  const targetInfo = useMemo(() => {
    const targets = targetsData?.data;
    return targets?.find(t => t.id === targetId);
  }, [targetsData, targetId]);

  // Resolve profile ID for scope management
  const { data: profilesData } = useProfiles();
  const shieldProgressSnap = useSnapshot(setupPanelStore).shieldProgress;

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

  const handleTabChange = useCallback((_: React.SyntheticEvent, newIdx: number) => {
    navigate(`/target/${targetId}/${TARGET_TABS[newIdx].slug}`, { replace: true });
  }, [navigate, targetId]);

  const targetName = targetInfo?.name ?? targetId;
  const isShielded = targetInfo?.shielded ?? false;

  const fallback = (
    <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}>
      <CircularLoader />
    </div>
  );

  return (
    <OverlayRoot>
      <ContentPanel $isDark={isDark}>
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
          <FullHeightArea>
            <Suspense fallback={fallback}>
              <LazyOverview embedded targetFilter={targetId} />
            </Suspense>
          </FullHeightArea>
        ) : activeTab === 'activity' ? (
          <FullHeightArea>
            <Suspense fallback={fallback}>
              <LazyActivity embedded fillHeight sourceFilter={targetId} />
            </Suspense>
          </FullHeightArea>
        ) : (
          <ScrollArea>
            <Suspense fallback={fallback}>
              {activeTab === 'policies' && <LazyPolicies embedded />}
              {activeTab === 'secrets' && <LazySecrets embedded />}
              {activeTab === 'settings' && <LazySettings embedded />}
            </Suspense>
          </ScrollArea>
        )}
      </ContentPanel>
    </OverlayRoot>
  );
});
TargetOverlay.displayName = 'TargetOverlay';
