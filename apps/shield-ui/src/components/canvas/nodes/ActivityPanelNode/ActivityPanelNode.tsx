import { memo } from 'react';
import type { NodeProps } from '@xyflow/react';
import { useTheme } from '@mui/material/styles';
import { formatDistanceToNow } from 'date-fns';
import { getEventDisplay, resolveEventColor, getEventSummary } from '../../../../utils/eventDisplay';
import type { ActivityPanelData } from '../../Canvas.types';
import {
  PanelWrapper, PanelHeader, PanelTitle, LiveDot,
  EventList, EventRow, EventIconWrap, EventContent,
  EventLabel, EventSummary, EventTime,
} from './ActivityPanelNode.styles';

export const ActivityPanelNode = memo(({ data }: NodeProps) => {
  const { events } = data as unknown as ActivityPanelData;
  const theme = useTheme();

  return (
    <PanelWrapper>
      <PanelHeader>
        <LiveDot />
        <PanelTitle>Activity</PanelTitle>
      </PanelHeader>
      <EventList>
        {events.length === 0 ? (
          <EventRow>
            <EventContent>
              <EventLabel style={{ color: theme.palette.text.secondary }}>
                No activity yet
              </EventLabel>
            </EventContent>
          </EventRow>
        ) : (
          events.map((event) => {
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
                <EventTime>
                  {formatDistanceToNow(event.timestamp, { addSuffix: true })}
                </EventTime>
              </EventRow>
            );
          })
        )}
      </EventList>
    </PanelWrapper>
  );
});
ActivityPanelNode.displayName = 'ActivityPanelNode';
