import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { useTheme } from '@mui/material/styles';
import { useSnapshot } from 'valtio';
import { eventStore } from '../../../../state/events';
import { getEventDisplay, resolveEventColor, getEventSummary } from '../../../../utils/eventDisplay';
import {
  PanelWrapper, PanelHeader, PanelTitle, LiveDot,
  EventList, EventRow, EventIconWrap, EventContent,
  EventLabel, EventSummary,
} from './ActivityPanelNode.styles';
import { TimeAgo } from '../../panels/ActivityPanel/TimeAgo';

export const ActivityPanelNode = memo((_props: NodeProps) => {
  const { events } = useSnapshot(eventStore);
  const theme = useTheme();

  // Show most recent 50 events
  const recentEvents = events.slice(0, 50);

  return (
    <div style={{ position: 'relative', cursor: 'default' }}>
      <Handle type="target" position={Position.Left} id="left" style={{ visibility: 'hidden' }} />
      <PanelWrapper>
        <PanelHeader>
          <LiveDot />
          <PanelTitle>Activity</PanelTitle>
        </PanelHeader>
        <EventList>
          {recentEvents.length === 0 ? (
            <EventRow>
              <EventContent>
                <EventLabel style={{ color: theme.palette.text.secondary }}>
                  No activity yet
                </EventLabel>
              </EventContent>
            </EventRow>
          ) : (
            recentEvents.map((event) => {
              const display = getEventDisplay(event.type);
              const IconComp = display.icon;
              const color = resolveEventColor(display.color, theme.palette);

              return (
                <EventRow key={event.id}>
                  <EventIconWrap $color={color} style={{ color }}>
                    <IconComp size={13} />
                  </EventIconWrap>
                  <EventContent>
                    <EventLabel>{display.label}</EventLabel>
                    <EventSummary>{getEventSummary(event)}</EventSummary>
                  </EventContent>
                  <TimeAgo timestamp={event.timestamp} />
                </EventRow>
              );
            })
          )}
        </EventList>
      </PanelWrapper>
    </div>
  );
});
ActivityPanelNode.displayName = 'ActivityPanelNode';
