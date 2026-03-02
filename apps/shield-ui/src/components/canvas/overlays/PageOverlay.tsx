/**
 * PageOverlay — full-screen panel that displays page content over the zoomed canvas.
 *
 * Props-driven: receives `page` and `tab` from the route, not from valtio state.
 * Lazy-loads the corresponding page component.
 * Supports tabbed navigation for Policies (commands/network/filesystem).
 * Escape key and back button navigate to / (zoom-out).
 */

import { lazy, Suspense, useCallback, useEffect, useRef, memo } from 'react';
import { useTheme } from '@mui/material/styles';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  Terminal,
  Eye, Zap, KeyRound, BarChart3, Settings as SettingsIcon,
} from 'lucide-react';
import { CircularLoader } from '../../../elements';
import { setSkipEntryAnimation } from '../../../state/canvas-drilldown';
import { clearScope } from '../../../state/scope';
import {
  OverlayRoot,
  ContentPanel,
  OverlayHeader,
  ScrollArea,
  FullHeightArea,
} from './PageOverlay.styles';

/* ---- Page → title and icon lookup ---- */

const PAGE_META: Record<string, { title: string; icon: typeof Terminal }> = {
  skills: { title: 'Skills', icon: Zap },
  secrets: { title: 'Secrets', icon: KeyRound },
  policies: { title: 'Policies', icon: Terminal },
  overview: { title: 'Overview', icon: Eye },
  settings: { title: 'Settings', icon: SettingsIcon },
  metrics: { title: 'System Metrics', icon: BarChart3 },
};

/* ---- Lazy-loaded page components ---- */

const LazySkills = lazy(() => import('../../../pages/Skills').then(m => ({ default: m.Skills })));
const LazySkillPage = lazy(() => import('../../../pages/SkillPage').then(m => ({ default: m.SkillPage })));
const LazyPolicies = lazy(() => import('../../../pages/Policies').then(m => ({ default: m.Policies })));
const LazySecrets = lazy(() => import('../../../pages/Secrets').then(m => ({ default: m.Secrets })));
const LazyOverview = lazy(() => import('../../../pages/Overview').then(m => ({ default: m.Overview })));
const LazySettings = lazy(() => import('../../../pages/Settings').then(m => ({ default: m.Settings })));
const LazyAllMetrics = lazy(() => import('./CoreMetricsView').then(m => ({ default: m.AllMetricsView })));

/* Metrics tabs removed — AllMetricsView shows all 4 charts at once */

/* ---- PageOverlay ---- */

interface PageOverlayProps {
  page: string;       // 'skills' | 'policies' | 'secrets' | 'overview' | 'settings' | 'metrics'
  tab?: string;       // 'commands' | 'network' | 'filesystem' (policies) or 'cpu' | 'memory' | 'disk' | 'network' (metrics)
  phase?: string;     // 'zooming-in' | 'zoomed'
  skipAnimation?: boolean;
}

export const PageOverlay = memo(({ page, tab, skipAnimation }: PageOverlayProps) => {
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';
  const navigate = useNavigate();

  // Clear scope on mount — PageOverlay only renders for system (non-target) routes,
  // so scope should always be null. Defense-in-depth against stale scope from previous target navigation.
  useEffect(() => {
    clearScope();
  }, []);

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

  const isSkillDetail = page === 'skills' && !!tab;

  const handleBack = useCallback(() => {
    if (isSkillDetail) {
      navigate('/skills');
    } else {
      navigate('/');
    }
  }, [navigate, isSkillDetail]);

  const meta = PAGE_META[page];
  if (!meta) return null;

  const Icon = meta.icon;

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

          {/* Icon + title */}
          <Icon size={20} color={theme.palette.text.primary} />
          <span style={{
            fontSize: 16,
            fontWeight: 700,
            fontFamily: "'Manrope', sans-serif",
            color: theme.palette.text.primary,
          }}>
            {isSkillDetail ? 'Skills / Detail' : meta.title}
          </span>

        </OverlayHeader>

        {page === 'overview' ? (
          <FullHeightArea>
            <Suspense fallback={
              <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}>
                <CircularLoader />
              </div>
            }>
              <LazyOverview embedded />
            </Suspense>
          </FullHeightArea>
        ) : (
          <ScrollArea>
            <Suspense fallback={
              <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}>
                <CircularLoader />
              </div>
            }>
              {page === 'skills' && !tab && <LazySkills embedded />}
              {page === 'skills' && tab && <LazySkillPage skillId={tab} embedded />}
              {page === 'policies' && (
                <LazyPolicies
                  embedded
                  embeddedTab={tab}
                />
              )}
              {page === 'secrets' && <LazySecrets embedded />}
              {page === 'settings' && <LazySettings embedded />}
              {page === 'metrics' && <LazyAllMetrics />}
            </Suspense>
          </ScrollArea>
        )}
      </ContentPanel>
    </OverlayRoot>
  );
});
PageOverlay.displayName = 'PageOverlay';
