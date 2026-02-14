/**
 * Sticky alerts section: fetches from backend API with acknowledge capability.
 * Displayed at the top of the panel, visible across all tabs.
 * Unacknowledged alerts shown prominently; acknowledged alerts in a separate muted list.
 */

import { useMemo, useState } from 'react';
import { useTheme } from '@mui/material/styles';
import IconButton from '@mui/material/IconButton';
import { AlertTriangle, X, CheckCheck, ChevronDown, ChevronRight } from 'lucide-react';
import { useAlerts, useAcknowledgeAlert, useAcknowledgeAllAlerts } from '../../../../api/hooks';
import type { Alert, AlertSeverity } from '@agenshield/ipc';
import { TimeAgo } from './TimeAgo';
import { AlertDetailDialog } from './AlertDetailDialog';
import {
  AlertsHeader,
  AlertsTitle,
  AlertCount,
  AlertItem,
  EventContent,
  EventLabel,
  EventSummary,
  SectionDivider,
  AcknowledgedHeader,
  AcknowledgedTitle,
  AcknowledgedItem,
} from './ActivityPanel.styles';

const MAX_ALERTS = 5;
const MAX_ACKNOWLEDGED = 10;

const severityColors: Record<AlertSeverity, string> = {
  critical: '#E1583E',
  warning: '#EEA45F',
  info: '#6BAEF2',
};

export function AlertsSection() {
  const theme = useTheme();
  const { data: response } = useAlerts();
  const acknowledgeAlert = useAcknowledgeAlert();
  const acknowledgeAllAlerts = useAcknowledgeAllAlerts();
  const [selectedAlert, setSelectedAlert] = useState<Alert | null>(null);
  const [showAcknowledged, setShowAcknowledged] = useState(false);

  const alertList = response?.data ?? [];

  const { unacknowledged, acknowledged } = useMemo(() => {
    const unack: Alert[] = [];
    const ack: Alert[] = [];
    for (const a of alertList) {
      if (a.acknowledgedAt) ack.push(a);
      else unack.push(a);
    }
    return { unacknowledged: unack, acknowledged: ack };
  }, [alertList]);

  const visibleAlerts = unacknowledged.slice(0, MAX_ALERTS);
  const visibleAcknowledged = acknowledged.slice(0, MAX_ACKNOWLEDGED);

  if (visibleAlerts.length === 0 && visibleAcknowledged.length === 0 && !selectedAlert) return null;

  const severityIcon = (severity: AlertSeverity) => {
    const color = severityColors[severity];
    return <AlertTriangle size={12} color={color} />;
  };

  const handleAcknowledge = (id: number) => {
    acknowledgeAlert.mutate(id);
    const currentIdx = alertList.findIndex((a) => a.id === id);
    const next = alertList.find((a, i) => i > currentIdx && !a.acknowledgedAt);
    if (next) {
      setSelectedAlert(next);
    } else {
      setSelectedAlert(null);
    }
  };

  const handleNext = () => {
    if (!selectedAlert) return;
    const currentIdx = alertList.findIndex((a) => a.id === selectedAlert.id);
    const next = alertList.find((a, i) => i > currentIdx && !a.acknowledgedAt);
    if (next) {
      setSelectedAlert(next);
    }
  };

  const hasNext = (() => {
    if (!selectedAlert) return false;
    const currentIdx = alertList.findIndex((a) => a.id === selectedAlert.id);
    return alertList.some((a, i) => i > currentIdx && !a.acknowledgedAt);
  })();

  return (
    <div>
      {/* Active (unacknowledged) alerts */}
      {visibleAlerts.length > 0 && (
        <>
          <AlertsHeader>
            <AlertsTitle>
              <AlertTriangle size={13} color="#E1583E" />
              <span style={{ color: theme.palette.text.primary }}>Alerts</span>
              <AlertCount>({unacknowledged.length})</AlertCount>
            </AlertsTitle>
            <IconButton
              size="small"
              onClick={() => acknowledgeAllAlerts.mutate()}
              sx={{ padding: '2px' }}
              title="Acknowledge all"
            >
              <CheckCheck size={13} />
            </IconButton>
          </AlertsHeader>
          {visibleAlerts.map((alert) => (
            <AlertItem key={alert.id} onClick={() => setSelectedAlert(alert)}>
              <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', marginTop: 2 }}>
                {severityIcon(alert.severity)}
              </div>
              <EventContent>
                <EventLabel>{alert.title}</EventLabel>
                <EventSummary>{alert.description}</EventSummary>
              </EventContent>
              <TimeAgo timestamp={new Date(alert.createdAt).getTime()} />
              <IconButton
                size="small"
                onClick={(e) => {
                  e.stopPropagation();
                  acknowledgeAlert.mutate(alert.id);
                }}
                sx={{ padding: '2px', flexShrink: 0, marginTop: '-2px' }}
                title="Acknowledge"
              >
                <X size={11} />
              </IconButton>
            </AlertItem>
          ))}
        </>
      )}

      {/* Acknowledged alerts — separate section */}
      {visibleAcknowledged.length > 0 && (
        <>
          {visibleAlerts.length > 0 && <SectionDivider />}
          <AcknowledgedHeader>
            <AcknowledgedTitle
              onClick={() => setShowAcknowledged(!showAcknowledged)}
              style={{ cursor: 'pointer', userSelect: 'none' }}
            >
              {showAcknowledged
                ? <ChevronDown size={12} />
                : <ChevronRight size={12} />}
              <span>Acknowledged</span>
              <AlertCount style={{ color: theme.palette.text.secondary }}>
                ({acknowledged.length})
              </AlertCount>
            </AcknowledgedTitle>
          </AcknowledgedHeader>
          {showAcknowledged && visibleAcknowledged.map((alert) => (
            <AcknowledgedItem key={alert.id} onClick={() => setSelectedAlert(alert)}>
              <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', marginTop: 2 }}>
                {severityIcon(alert.severity)}
              </div>
              <EventContent>
                <EventLabel>{alert.title}</EventLabel>
                <EventSummary>{alert.description}</EventSummary>
              </EventContent>
              <TimeAgo timestamp={new Date(alert.createdAt).getTime()} />
            </AcknowledgedItem>
          ))}
        </>
      )}

      {/* Divider between alerts and activity feed */}
      {(visibleAlerts.length > 0 || visibleAcknowledged.length > 0) && <SectionDivider />}

      <AlertDetailDialog
        alert={selectedAlert}
        onClose={() => setSelectedAlert(null)}
        onAcknowledge={handleAcknowledge}
        onNext={handleNext}
        hasNext={hasNext}
      />
    </div>
  );
}
