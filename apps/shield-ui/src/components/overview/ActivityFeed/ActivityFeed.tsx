import { useMemo } from 'react';
import { Typography, Card, CardContent } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { formatDistanceToNow } from 'date-fns';
import { useSnapshot } from 'valtio';
import { eventStore } from '../../../state/events';
import { getEventDisplay, resolveEventColor, getEventSummary, resolveTargetNames, isNoiseEvent } from '../../../utils/eventDisplay';
import { useProfiles } from '../../../api/hooks';
import { EmptyState } from '../../shared/EmptyState';
import { Root, EventItem, EventIcon, EventContent } from './ActivityFeed.styles';

interface ActivityFeedProps {
  profileId?: string;
}

export function ActivityFeed({ profileId }: ActivityFeedProps = {}) {
  const theme = useTheme();
  const { events: allEvents } = useSnapshot(eventStore);
  const { data: profilesData } = useProfiles();
  const recentEvents = useMemo(() => {
    let filtered = allEvents.filter((e) => !isNoiseEvent(e));
    if (profileId) {
      filtered = filtered.filter((e) => e.profileId === profileId);
    }
    return filtered.slice(0, 20);
  }, [allEvents, profileId]);
  const targetNameMap = useMemo(() => {
    const profiles = profilesData?.data ?? [];
    const map = new Map<string, string>();
    for (const p of profiles as Array<{ id: string; name: string; targetName?: string }>) {
      if (p.targetName) map.set(p.targetName, p.name);
      map.set(p.id, p.name);
    }
    return map;
  }, [profilesData]);

  return (
    <Card sx={{ overflow: 'hidden' }}>
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
                    <Typography variant="caption" color="text.secondary" noWrap>
                      {resolveTargetNames(getEventSummary(event), targetNameMap)}
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
