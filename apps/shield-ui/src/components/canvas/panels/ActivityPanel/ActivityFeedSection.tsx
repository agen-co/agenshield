/**
 * Tabbed activity section: "All", "Security", and "Network" tabs.
 */

import { useState, useMemo, memo } from 'react';
import { useTheme } from '@mui/material/styles';
import Tab from '@mui/material/Tab';
import type { SSEEvent } from '../../../../state/events';
import { getEventDisplay, resolveEventColor, getEventSummary, isNoiseEvent } from '../../../../utils/eventDisplay';
import { classifyEventCategory, isAlertEvent } from '../../utils/eventClassification';
import { TimeAgo } from './TimeAgo';
import {
  StyledTabs,
  FeedContainer,
  EventRow,
  EventIconWrap,
  EventContent,
  EventLabel,
  EventSummary,
  LiveDot,
  EmptyState,
} from './ActivityPanel.styles';

const MAX_FEED_EVENTS = 50;

interface ActivityFeedSectionProps {
  events: SSEEvent[];
}

function isSecurityEvent(event: SSEEvent): boolean {
  return (
    isAlertEvent(event) ||
    event.type.startsWith('security:') ||
    event.type === 'exec:denied' ||
    event.type === 'exec:monitored'
  );
}

function isNetworkEvent(event: SSEEvent): boolean {
  return (
    classifyEventCategory(event) === 'network' ||
    event.type === 'api:request' ||
    event.type === 'api:outbound'
  );
}

const EventRowItem = memo(function EventRowItem({ event }: { event: SSEEvent }) {
  const theme = useTheme();
  const display = getEventDisplay(event.type);
  const IconComp = display.icon;
  const color = resolveEventColor(display.color, theme.palette);

  return (
    <EventRow>
      <EventIconWrap style={{ color }}>
        <IconComp size={12} />
      </EventIconWrap>
      <EventContent>
        <EventLabel>{display.label}</EventLabel>
        <EventSummary>{getEventSummary(event)}</EventSummary>
      </EventContent>
      <TimeAgo timestamp={event.timestamp} />
    </EventRow>
  );
});

export function ActivityFeedSection({ events }: ActivityFeedSectionProps) {
  const [tab, setTab] = useState(0);

  const allEvents = useMemo(() => {
    return events.filter((e) => !isNoiseEvent(e)).slice(0, MAX_FEED_EVENTS);
  }, [events]);

  const filteredEvents = useMemo(() => {
    if (tab === 1) return allEvents.filter(isSecurityEvent);
    if (tab === 2) return allEvents.filter(isNetworkEvent);
    return allEvents;
  }, [allEvents, tab]);

  return (
    <>
      <StyledTabs value={tab} onChange={(_, v) => setTab(v)}>
        <Tab
          label={
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <LiveDot />
              All
            </span>
          }
        />
        <Tab label="Security" />
        <Tab label="Network" />
      </StyledTabs>

      <FeedContainer>
        {filteredEvents.length === 0 ? (
          <EmptyState>No activity yet</EmptyState>
        ) : (
          filteredEvents.map((event) => (
            <EventRowItem key={event.id} event={event} />
          ))
        )}
      </FeedContainer>
    </>
  );
}
