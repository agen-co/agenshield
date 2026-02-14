/**
 * Tabbed activity section: "Activity" (chronological feed) and "By Type" (categorized).
 */

import { useState, useMemo } from 'react';
import { useTheme } from '@mui/material/styles';
import Tab from '@mui/material/Tab';
import { formatDistanceToNow } from 'date-fns';
import type { SSEEvent } from '../../../../state/events';
import { getEventDisplay, resolveEventColor, getEventSummary, isNoiseEvent } from '../../../../utils/eventDisplay';
import { CategoryList } from './CategoryList';
import {
  StyledTabs,
  FeedContainer,
  EventRow,
  EventIconWrap,
  EventContent,
  EventLabel,
  EventSummary,
  EventTime,
  LiveDot,
  EmptyState,
} from './ActivityPanel.styles';

const MAX_FEED_EVENTS = 50;

interface ActivityFeedSectionProps {
  events: SSEEvent[];
}

export function ActivityFeedSection({ events }: ActivityFeedSectionProps) {
  const theme = useTheme();
  const [tab, setTab] = useState(0);

  const filteredEvents = useMemo(() => {
    return events.filter((e) => !isNoiseEvent(e)).slice(0, MAX_FEED_EVENTS);
  }, [events]);

  return (
    <>
      <StyledTabs value={tab} onChange={(_, v) => setTab(v)}>
        <Tab
          label={
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <LiveDot />
              Activity
            </span>
          }
        />
        <Tab label="By Type" />
      </StyledTabs>

      {tab === 0 && (
        <FeedContainer>
          {filteredEvents.length === 0 ? (
            <EmptyState>No activity yet</EmptyState>
          ) : (
            filteredEvents.map((event) => {
              const display = getEventDisplay(event.type);
              const IconComp = display.icon;
              const color = resolveEventColor(display.color, theme.palette);

              return (
                <EventRow key={event.id}>
                  <EventIconWrap style={{ color }}>
                    <IconComp size={13} />
                  </EventIconWrap>
                  <EventContent>
                    <EventLabel>{display.label}</EventLabel>
                    <EventSummary>{getEventSummary(event)}</EventSummary>
                  </EventContent>
                  <EventTime>
                    {formatDistanceToNow(event.timestamp, { addSuffix: true })}
                  </EventTime>
                </EventRow>
              );
            })
          )}
        </FeedContainer>
      )}

      {tab === 1 && <CategoryList events={events} />}
    </>
  );
}
