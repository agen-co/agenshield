import { useMemo } from 'react';
import { Typography, Card, CardContent } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import {
  Globe,
  ShieldAlert,
  ArrowRightLeft,
  Settings as SettingsIcon,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { useSnapshot } from 'valtio';
import { eventStore, type SSEEvent } from '../../../state/events';
import { EmptyState } from '../../shared/EmptyState';
import { Root, EventItem, EventIcon, EventContent } from './ActivityFeed.styles';

function getEventDisplay(event: SSEEvent) {
  const mapping = {
    'api:request': { icon: Globe, label: 'API Request' },
    'security:status': { icon: ShieldAlert, label: 'Security' },
    'security:alert': { icon: ShieldAlert, label: 'Security Alert' },
    'broker:request': { icon: ArrowRightLeft, label: 'Broker' },
    'broker:response': { icon: ArrowRightLeft, label: 'Broker Response' },
    'config:changed': { icon: SettingsIcon, label: 'Config Changed' },
  } as Record<string, { icon: React.ComponentType<{ size?: number }>; label: string }>;

  return mapping[event.type] ?? { icon: Globe, label: event.type };
}

export function ActivityFeed() {
  const theme = useTheme();
  const { events: allEvents } = useSnapshot(eventStore);
  const recentEvents = useMemo(() => allEvents.slice(0, 20), [allEvents]);

  const colorForType = (type: string): string => {
    if (type.startsWith('security:')) return theme.palette.warning.main;
    if (type.startsWith('broker:')) return theme.palette.info.main;
    if (type.startsWith('config:')) return theme.palette.secondary.main;
    return theme.palette.primary.main;
  };

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
              const display = getEventDisplay(event);
              const IconComp = display.icon;
              const color = colorForType(event.type);

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
