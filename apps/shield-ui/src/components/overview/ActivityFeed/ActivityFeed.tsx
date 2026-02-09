import { useMemo } from 'react';
import { Typography, Card, CardContent } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { formatDistanceToNow } from 'date-fns';
import { useSnapshot } from 'valtio';
import { eventStore } from '../../../state/events';
import { getEventDisplay, resolveEventColor } from '../../../utils/eventDisplay';
import { EmptyState } from '../../shared/EmptyState';
import { Root, EventItem, EventIcon, EventContent } from './ActivityFeed.styles';
import type { SSEEvent } from '../../../state/events';

function getActivitySummary(event: SSEEvent): string {
  const d = event.data as Record<string, unknown>;

  if (event.type === 'api:outbound') {
    const ctx = d.context ?? '';
    const status = d.statusCode ?? '';
    const url = d.url ?? '';
    return `${ctx} [${status}] ${url}`;
  }
  if (event.type === 'exec:denied') {
    const command = d.command ?? d.target ?? '';
    const reason = d.reason ?? d.error ?? '';
    return reason ? `${command} — ${reason}` : String(command);
  }
  if (event.type === 'interceptor:event') {
    const operation = d.operation ?? '';
    const target = d.target ?? '';
    const type = d.type ?? '';
    const error = d.error as string | undefined;
    if (type === 'denied' || type === 'deny') {
      return error ? `BLOCKED ${operation}: ${target} — ${error}` : `BLOCKED ${operation}: ${target}`;
    }
    return `${operation} → ${target} [${type}]`;
  }
  if (event.type === 'skills:untrusted_detected') {
    const name = d.name ?? '';
    const reason = d.reason ?? '';
    return reason ? `${name} — ${reason}` : String(name);
  }
  if (event.type === 'skills:uninstalled') {
    return String(d.name ?? '');
  }

  return (d.message as string) ??
    (d.url as string) ??
    (d.method as string) ??
    (d.name as string) ??
    JSON.stringify(d).slice(0, 80);
}

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
                      {getActivitySummary(event)}
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
