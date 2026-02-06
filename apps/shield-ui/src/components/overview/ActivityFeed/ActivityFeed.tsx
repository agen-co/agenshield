import { useMemo } from 'react';
import { Typography, Card, CardContent } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { formatDistanceToNow } from 'date-fns';
import { useSnapshot } from 'valtio';
import { eventStore } from '../../../state/events';
import { getEventDisplay, resolveEventColor } from '../../../utils/eventDisplay';
import { EmptyState } from '../../shared/EmptyState';
import { Root, EventItem, EventIcon, EventContent } from './ActivityFeed.styles';

export function ActivityFeed() {
  const theme = useTheme();
  const { events: allEvents } = useSnapshot(eventStore);
  const recentEvents = useMemo(() => allEvents.slice(0, 20), [allEvents]);

  return (
    <Card>
      <CardContent>
        <Typography variant="h6" gutterBottom fontWeight={600}>
          Activity Feed
        </Typography>
        <Root>
          {recentEvents.length === 0 ? (
            <EmptyState
              title="No activity yet"
              description="Events will appear here as they occur."
            />
          ) : (
            recentEvents.map((event) => {
              const display = getEventDisplay(event.type);
              const IconComp = display.icon;
              const color = resolveEventColor(display.color, theme.palette);

              return (
                <EventItem key={event.id}>
                  <EventIcon $color={color}>
                    <IconComp size={14} />
                  </EventIcon>
                  <EventContent>
                    <Typography variant="body2" fontWeight={500}>
                      {display.label}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {(event.data?.message as string) ??
                        (event.data?.url as string) ??
                        (event.data?.method as string) ??
                        JSON.stringify(event.data).slice(0, 80)}
                    </Typography>
                  </EventContent>
                  <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0 }}>
                    {formatDistanceToNow(event.timestamp, { addSuffix: true })}
                  </Typography>
                </EventItem>
              );
            })
          )}
        </Root>
      </CardContent>
    </Card>
  );
}
