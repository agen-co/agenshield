/**
 * EventDetailPanel — right-side detail panel for inspecting a selected event.
 *
 * Uses the shared SidePanel pattern (InlinePanel on desktop, Drawer on mobile).
 */

import { memo } from 'react';
import { Box, Typography, Chip, IconButton, Drawer, useMediaQuery, useTheme } from '@mui/material';
import { X } from 'lucide-react';
import { format } from 'date-fns';
import type { SSEEvent } from '../../state/events';
import {
  getEventDisplay,
  getEventSummary,
  getEventStatus,
  getEventSeverity,
  resolveEventColor,
  SEVERITY_COLORS,
} from '../../utils/eventDisplay';
import { StatusBadge } from '../shared/StatusBadge';
import { InlinePanel, PanelHeader, PanelContent } from '../shared/SidePanel/SidePanel.styles';

interface EventDetailPanelProps {
  event: SSEEvent | null;
  onClose: () => void;
}

const PANEL_WIDTH = 400;

export const EventDetailPanel = memo(({ event, onClose }: EventDetailPanelProps) => {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));

  const content = event ? <PanelBody event={event} onClose={onClose} /> : null;

  if (isMobile) {
    return (
      <Drawer
        anchor="right"
        open={!!event}
        onClose={onClose}
        PaperProps={{ sx: { width: PANEL_WIDTH, maxWidth: '100vw' } }}
      >
        {content}
      </Drawer>
    );
  }

  return (
    <InlinePanel $open={!!event} $width={PANEL_WIDTH}>
      {content}
    </InlinePanel>
  );
});
EventDetailPanel.displayName = 'EventDetailPanel';

function PanelBody({ event, onClose }: { event: SSEEvent; onClose: () => void }) {
  const theme = useTheme();
  const display = getEventDisplay(event.type);
  const IconComp = display.icon;
  const color = resolveEventColor(display.color, theme.palette);
  const severity = getEventSeverity(event);
  const status = getEventStatus(event);
  const summary = getEventSummary(event);

  return (
    <>
      <PanelHeader>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0, flex: 1 }}>
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 28,
              height: 28,
              borderRadius: '8px',
              backgroundColor: `${color}14`,
              color,
              flexShrink: 0,
            }}
          >
            <IconComp size={15} />
          </Box>
          <Typography variant="subtitle2" fontWeight={600} noWrap>
            {display.label}
          </Typography>
        </Box>
        <IconButton onClick={onClose} size="small">
          <X size={18} />
        </IconButton>
      </PanelHeader>

      <PanelContent>
        {/* Summary */}
        <Typography
          variant="body2"
          sx={{
            fontFamily: "'IBM Plex Mono', monospace",
            mb: 2.5,
            wordBreak: 'break-word',
          }}
        >
          {summary}
        </Typography>

        {/* Metadata grid */}
        <Box sx={{ display: 'grid', gridTemplateColumns: '100px 1fr', gap: 1.5, mb: 2.5 }}>
          <Typography variant="caption" color="text.secondary" fontWeight={600}>
            ID
          </Typography>
          <Typography
            variant="caption"
            sx={{ fontFamily: "'IBM Plex Mono', monospace", wordBreak: 'break-all' }}
          >
            {event.id}
          </Typography>

          <Typography variant="caption" color="text.secondary" fontWeight={600}>
            Timestamp
          </Typography>
          <Typography
            variant="caption"
            sx={{ fontFamily: "'IBM Plex Mono', monospace" }}
          >
            {format(event.timestamp, "yyyy-MM-dd'T'HH:mm:ss.SSSxxx")}
          </Typography>

          <Typography variant="caption" color="text.secondary" fontWeight={600}>
            Type
          </Typography>
          <Typography
            variant="caption"
            sx={{ fontFamily: "'IBM Plex Mono', monospace" }}
          >
            {event.type}
          </Typography>

          <Typography variant="caption" color="text.secondary" fontWeight={600}>
            Source
          </Typography>
          <Typography
            variant="caption"
            sx={{ fontFamily: "'IBM Plex Mono', monospace" }}
          >
            {event.source ?? 'daemon'}
          </Typography>

          <Typography variant="caption" color="text.secondary" fontWeight={600}>
            Severity
          </Typography>
          <Box>
            <Chip
              label={severity}
              size="small"
              sx={{
                height: 20,
                fontSize: 11,
                fontWeight: 600,
                bgcolor: `${SEVERITY_COLORS[severity]}18`,
                color: SEVERITY_COLORS[severity],
                '& .MuiChip-label': { px: 1 },
              }}
            />
          </Box>

          <Typography variant="caption" color="text.secondary" fontWeight={600}>
            Status
          </Typography>
          <Box>
            <StatusBadge label={status.label} variant={status.variant} dot={false} size="small" />
          </Box>
        </Box>

        {/* JSON data */}
        <Typography variant="caption" color="text.secondary" fontWeight={600} sx={{ display: 'block', mb: 1 }}>
          Payload
        </Typography>
        <Box
          sx={{
            p: 1.5,
            bgcolor: 'action.hover',
            borderRadius: 1,
            overflow: 'auto',
            maxHeight: 'calc(100vh - 480px)',
            fontFamily: "'IBM Plex Mono', monospace",
            fontSize: '0.72rem',
            lineHeight: 1.6,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-all',
          }}
          component="pre"
        >
          {JSON.stringify(event.data, null, 2)}
        </Box>
      </PanelContent>
    </>
  );
}
