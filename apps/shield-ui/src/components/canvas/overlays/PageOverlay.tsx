/**
 * PageOverlay — full-screen panel that displays page content over the zoomed canvas.
 *
 * Props-driven: receives `page` and `tab` from the route, not from valtio state.
 * Lazy-loads the corresponding page component.
 * Supports tabbed navigation for Policies (commands/network/filesystem).
 * Escape key and back button navigate to / (zoom-out).
 */

import { lazy, Suspense, useCallback, useEffect, memo } from 'react';
import { useTheme } from '@mui/material/styles';
import { Tabs, Tab } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  Network, Terminal, HardDrive, MemoryStick,
  Eye, Zap, KeyRound, BarChart3,
} from 'lucide-react';
import { CircularLoader } from '../../../elements';
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
  settings: { title: 'Settings', icon: MemoryStick },
  metrics: { title: 'System Metrics', icon: BarChart3 },
};

/* ---- Lazy-loaded page components ---- */

const LazySkills = lazy(() => import('../../../pages/Skills').then(m => ({ default: m.Skills })));
const LazyPolicies = lazy(() => import('../../../pages/Policies').then(m => ({ default: m.Policies })));
const LazySecrets = lazy(() => import('../../../pages/Secrets').then(m => ({ default: m.Secrets })));
const LazyOverview = lazy(() => import('../../../pages/Overview').then(m => ({ default: m.Overview })));
const LazySettings = lazy(() => import('../../../pages/Settings').then(m => ({ default: m.Settings })));
const LazyAllMetrics = lazy(() => import('./CoreMetricsView').then(m => ({ default: m.AllMetricsView })));

/* ---- Policy tab config ---- */

const POLICY_TABS = [
  { slug: 'commands', label: 'Commands', icon: Terminal },
  { slug: 'network', label: 'Network', icon: Network },
  { slug: 'filesystem', label: 'Filesystem', icon: HardDrive },
] as const;

/* Metrics tabs removed — AllMetricsView shows all 4 charts at once */

/* ---- PageOverlay ---- */

interface PageOverlayProps {
  page: string;       // 'skills' | 'policies' | 'secrets' | 'overview' | 'settings' | 'metrics'
  tab?: string;       // 'commands' | 'network' | 'filesystem' (policies) or 'cpu' | 'memory' | 'disk' | 'network' (metrics)
  phase?: string;     // 'zooming-in' | 'zoomed'
}

export const PageOverlay = memo(({ page, tab }: PageOverlayProps) => {
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';
  const navigate = useNavigate();

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

  const handleTabChange = useCallback((_: React.SyntheticEvent, newIdx: number) => {
    navigate(`/policies/${POLICY_TABS[newIdx].slug}`, { replace: true });
  }, [navigate]);

  const handlePoliciesTabChange = useCallback((newTab: string) => {
    navigate(`/policies/${newTab}`, { replace: true });
  }, [navigate]);


  const meta = PAGE_META[page];
  if (!meta) return null;

  const Icon = meta.icon;
  const policyTabIdx = page === 'policies'
    ? Math.max(0, POLICY_TABS.findIndex(t => t.slug === (tab ?? 'commands')))
    : -1;

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

          {/* Icon + title */}
          <Icon size={20} color={theme.palette.text.primary} />
          <span style={{
            fontSize: 16,
            fontWeight: 700,
            fontFamily: "'Manrope', sans-serif",
            color: theme.palette.text.primary,
          }}>
            {meta.title}
          </span>

          {/* Policy tabs (inline in header) */}
          {page === 'policies' && (
            <Tabs
              value={policyTabIdx}
              onChange={handleTabChange}
              sx={{ ml: 'auto', minHeight: 36 }}
            >
              {POLICY_TABS.map((t) => {
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
          )}

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
              {page === 'skills' && <LazySkills embedded />}
              {page === 'policies' && (
                <LazyPolicies
                  embedded
                  embeddedTab={tab ?? 'commands'}
                  onTabChange={handlePoliciesTabChange}
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
