/**
 * Floating glassmorphism activity panel on the right side of the canvas.
 * Contains sticky alerts section (backend API) + tabbed activity feed.
 * Wrapped in React.memo to isolate from Canvas re-renders — only re-renders
 * when its own valtio snapshot changes.
 */

import { memo } from 'react';
import { useSnapshot } from 'valtio';
import { eventStore } from '../../../../state/events';
import { AlertsSection } from './AlertsSection';
import { ActivityFeedSection } from './ActivityFeedSection';
import { PanelContainer } from './ActivityPanel.styles';

export const ActivityPanel = memo(function ActivityPanel() {
  const { events } = useSnapshot(eventStore);

  return (
    <PanelContainer>
      <AlertsSection />
      <ActivityFeedSection events={events as typeof eventStore.events} />
    </PanelContainer>
  );
});
