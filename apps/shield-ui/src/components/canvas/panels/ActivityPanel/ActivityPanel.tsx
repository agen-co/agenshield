/**
 * Floating glassmorphism activity panel on the right side of the canvas.
 * Contains sticky alerts section (backend API) + tabbed activity feed.
 * Wrapped in React.memo to isolate from Canvas re-renders — only re-renders
 * when its own valtio snapshot changes.
 */

import { memo } from 'react';
import { useSnapshot } from 'valtio';
import { useTheme } from '@mui/material/styles';
import { eventStore } from '../../../../state/events';
import { AlertsSection } from './AlertsSection';
import { ActivityFeedSection } from './ActivityFeedSection';
import { PanelContainer } from './ActivityPanel.styles';

/** Decorative PCB trace stub on the left edge of the panel */
function TraceStub() {
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';
  const gold = isDark ? '#C8A44E' : '#B8943E';

  return (
    <svg
      width={16}
      height={24}
      viewBox="0 0 16 24"
      style={{
        position: 'absolute',
        left: -16,
        top: 20,
        overflow: 'visible',
      }}
    >
      {/* Horizontal trace line */}
      <line x1={0} y1={12} x2={12} y2={12} stroke={gold} strokeWidth={1.5} opacity={0.5} />
      {/* Via pad circle */}
      <circle cx={3} cy={12} r={3.5} fill="none" stroke={gold} strokeWidth={1} opacity={0.4} />
      <circle cx={3} cy={12} r={1.5} fill={gold} opacity={0.3} />
    </svg>
  );
}

export const ActivityPanel = memo(function ActivityPanel() {
  const { events } = useSnapshot(eventStore);

  return (
    <PanelContainer>
      <TraceStub />
      <AlertsSection />
      <ActivityFeedSection events={events as typeof eventStore.events} />
    </PanelContainer>
  );
});
