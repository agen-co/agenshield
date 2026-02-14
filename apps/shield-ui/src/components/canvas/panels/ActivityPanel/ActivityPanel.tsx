/**
 * Fixed full-height activity panel on the right side of the canvas.
 * Contains alerts section + tabbed activity/categorized feed.
 */

import { useSnapshot } from 'valtio';
import { eventStore } from '../../../../state/events';
import { AlertsSection } from './AlertsSection';
import { ActivityFeedSection } from './ActivityFeedSection';
import { PanelContainer } from './ActivityPanel.styles';

export function ActivityPanel() {
  const { events } = useSnapshot(eventStore);

  return (
    <PanelContainer>
      <AlertsSection events={events as typeof eventStore.events} />
      <ActivityFeedSection events={events as typeof eventStore.events} />
    </PanelContainer>
  );
}
