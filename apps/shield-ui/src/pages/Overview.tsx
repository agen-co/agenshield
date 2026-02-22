/**
 * Overview page — full-viewport monitor dashboard.
 *
 * Layout (no page scrolling):
 *   - Compact metric cards row (flexShrink: 0)
 *   - StatsRow + AlertsBanner (flexShrink: 0)
 *   - Main area (flex: 1): TargetList | Activity table (fillHeight) | EventDetailPanel
 */

import { useState, useCallback } from 'react';
import { Box } from '@mui/material';
import { useStatus, useConfig, useSecurity } from '../api/hooks';
import { tokens } from '../styles/tokens';
import { slideIn } from '../styles/animations';
import { PageHeader } from '../components/shared/PageHeader';
import { StatsRow } from '../components/overview/StatsRow';
import { AlertsBanner } from '../components/overview/AlertsBanner';
import { MetricCard } from '../components/overview/MetricCard';
import { TargetList } from '../components/overview/TargetList';
import { EventDetailPanel } from '../components/overview/EventDetailPanel';
import { Activity } from './Activity';
import type { SSEEvent } from '../state/events';

export function Overview({ embedded, targetFilter }: { embedded?: boolean; targetFilter?: string } = {}) {
  const { data: status, isLoading: statusLoading } = useStatus();
  const { data: config, isLoading: configLoading } = useConfig();
  const { data: security } = useSecurity();

  const [selectedSource, setSelectedSource] = useState(targetFilter ?? 'all');
  const [selectedEvent, setSelectedEvent] = useState<SSEEvent | null>(null);

  const handleSourceSelect = useCallback((source: string) => {
    setSelectedSource(source);
  }, []);

  const handleSelectEvent = useCallback((event: SSEEvent | null) => {
    setSelectedEvent(event);
  }, []);

  const cardAnim = (delay: number) => ({
    animation: `${slideIn} 0.4s ease-out ${delay}ms both`,
  });

  return (
    <Box sx={embedded
      ? { display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, overflow: 'hidden' }
      : { maxWidth: tokens.page.maxWidth, mx: 'auto', display: 'flex', flexDirection: 'column', height: '100vh' }
    }>
      {!embedded && (
        <Box sx={{ flexShrink: 0 }}>
          <PageHeader
            title="Overview"
            description="Monitor your AgenShield daemon status and activity."
          />
        </Box>
      )}

      {/* Compact metric cards row */}
      <Box sx={{ display: 'flex', gap: 1.5, mb: 2, flexWrap: 'wrap', flexShrink: 0, ...cardAnim(50) }}>
        <MetricCard label="CPU" dataKey="cpuPercent" compact />
        <MetricCard label="Memory" dataKey="memPercent" compact />
        <MetricCard label="Disk" dataKey="diskPercent" compact />
        <MetricCard label="Network" dataKey="netUp" unit="B/s" compact />
      </Box>

      <Box sx={{ flexShrink: 0 }}>
        <StatsRow
          status={status}
          config={config}
          security={security}
          statusLoading={statusLoading}
          configLoading={configLoading}
        />
        <AlertsBanner />
      </Box>

      {/* Main area: Target list + Activity log + Event detail panel */}
      <Box
        sx={{
          display: 'flex',
          mt: 2,
          border: '1px solid',
          borderColor: 'divider',
          borderRadius: 2,
          overflow: 'hidden',
          flex: 1,
          minHeight: 0,
          ...cardAnim(100),
        }}
      >
        {!targetFilter && (
          <TargetList selected={selectedSource} onSelect={handleSourceSelect} />
        )}
        <Box sx={{ flex: 1, minWidth: 0, p: 2, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <Activity
            embedded
            fillHeight
            sourceFilter={targetFilter ?? selectedSource}
            selectedEventId={selectedEvent?.id ?? null}
            onSelectEvent={handleSelectEvent}
          />
        </Box>
        <EventDetailPanel event={selectedEvent} onClose={() => setSelectedEvent(null)} />
      </Box>
    </Box>
  );
}
