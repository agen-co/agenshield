/**
 * Top section: filtered critical/warning events with dismiss capability.
 */

import { useState, useMemo } from 'react';
import { useTheme } from '@mui/material/styles';
import IconButton from '@mui/material/IconButton';
import { AlertTriangle, X } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import type { SSEEvent } from '../../../../state/events';
import { getEventDisplay, resolveEventColor, getEventSummary } from '../../../../utils/eventDisplay';
import { isAlertEvent } from '../../utils/eventClassification';
import {
  AlertsHeader,
  AlertsTitle,
  AlertCount,
  AlertItem,
  EventIconWrap,
  EventContent,
  EventLabel,
  EventSummary,
  EventTime,
} from './ActivityPanel.styles';

const MAX_ALERTS = 5;

interface AlertsSectionProps {
  events: SSEEvent[];
}

export function AlertsSection({ events }: AlertsSectionProps) {
  const theme = useTheme();
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set());

  const alerts = useMemo(() => {
    return events
      .filter((e) => isAlertEvent(e) && !dismissed.has(e.id))
      .slice(0, MAX_ALERTS);
  }, [events, dismissed]);

  if (alerts.length === 0) return null;

  const dismissAll = () => {
    setDismissed((prev) => {
      const next = new Set(prev);
      for (const a of alerts) next.add(a.id);
      return next;
    });
  };

  return (
    <div>
      <AlertsHeader>
        <AlertsTitle>
          <AlertTriangle size={14} color="#E1583E" />
          <span style={{ color: theme.palette.text.primary }}>Alerts</span>
          <AlertCount>({alerts.length})</AlertCount>
        </AlertsTitle>
        <IconButton size="small" onClick={dismissAll} sx={{ padding: '2px' }}>
          <X size={14} />
        </IconButton>
      </AlertsHeader>
      {alerts.map((event) => {
        const display = getEventDisplay(event.type);
        const IconComp = display.icon;
        const color = resolveEventColor(display.color, theme.palette);

        return (
          <AlertItem key={event.id}>
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
          </AlertItem>
        );
      })}
    </div>
  );
}
