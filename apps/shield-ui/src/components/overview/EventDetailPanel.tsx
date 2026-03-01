/**
 * EventDetailPanel — right-side detail panel for inspecting a selected event.
 *
 * Uses the shared SidePanel pattern (InlinePanel on desktop, Drawer on mobile).
 */

import { memo, useState } from 'react';
import { Box, Typography, Chip, IconButton, Drawer, useMediaQuery, useTheme, Collapse } from '@mui/material';
import { ChevronDown, ChevronRight } from 'lucide-react';
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
            Profile
          </Typography>
          <Typography
            variant="caption"
            sx={{ fontFamily: "'IBM Plex Mono', monospace" }}
          >
            {event.profileId ?? '—'}
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

        {/* Structured payload for known event types, raw JSON fallback */}
        {event.type === 'skills:integrity_violation' ? (
          <IntegrityViolationDetail data={event.data as Record<string, unknown>} />
        ) : (
          <>
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
          </>
        )}
      </PanelContent>
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  Structured detail for integrity violation events                    */
/* ------------------------------------------------------------------ */

const monoSx = { fontFamily: "'IBM Plex Mono', monospace", fontSize: '0.72rem', lineHeight: 1.5 } as const;

function IntegrityViolationDetail({ data }: { data: Record<string, unknown> }) {
  const theme = useTheme();
  const [showRaw, setShowRaw] = useState(false);

  const checkedPath = String(data.checkedPath ?? '');
  const action = String(data.action ?? '');
  const modifiedFiles = Array.isArray(data.modifiedFiles) ? (data.modifiedFiles as string[]) : [];
  const missingFiles = Array.isArray(data.missingFiles) ? (data.missingFiles as string[]) : [];
  const unexpectedFiles = Array.isArray(data.unexpectedFiles) ? (data.unexpectedFiles as string[]) : [];

  const joinPath = (rel: string) => checkedPath ? `${checkedPath}/${rel}` : rel;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {/* Action chip */}
      {action && (
        <Box>
          <Typography variant="caption" color="text.secondary" fontWeight={600} sx={{ display: 'block', mb: 0.5 }}>
            Action Taken
          </Typography>
          <Chip
            label={action}
            size="small"
            color={action === 'quarantine' ? 'error' : 'warning'}
            sx={{ height: 22, fontSize: 11, fontWeight: 600 }}
          />
        </Box>
      )}

      {/* Base path */}
      {checkedPath && (
        <Box>
          <Typography variant="caption" color="text.secondary" fontWeight={600} sx={{ display: 'block', mb: 0.5 }}>
            Checked Path
          </Typography>
          <Typography variant="caption" sx={{ ...monoSx, wordBreak: 'break-all' }}>
            {checkedPath}
          </Typography>
        </Box>
      )}

      {/* File lists */}
      {modifiedFiles.length > 0 && (
        <FileList
          label="Modified Files"
          files={modifiedFiles}
          color={theme.palette.warning.main}
          joinPath={joinPath}
        />
      )}
      {missingFiles.length > 0 && (
        <FileList
          label="Missing Files"
          files={missingFiles}
          color={theme.palette.error.main}
          joinPath={joinPath}
        />
      )}
      {unexpectedFiles.length > 0 && (
        <FileList
          label="Unexpected Files"
          files={unexpectedFiles}
          color={theme.palette.info.main}
          joinPath={joinPath}
        />
      )}

      {/* Collapsible raw JSON */}
      <Box>
        <Box
          onClick={() => setShowRaw(!showRaw)}
          sx={{ display: 'flex', alignItems: 'center', gap: 0.5, cursor: 'pointer', userSelect: 'none' }}
        >
          {showRaw ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          <Typography variant="caption" color="text.secondary" fontWeight={600}>
            Raw Payload
          </Typography>
        </Box>
        <Collapse in={showRaw}>
          <Box
            sx={{
              mt: 1,
              p: 1.5,
              bgcolor: 'action.hover',
              borderRadius: 1,
              overflow: 'auto',
              maxHeight: 300,
              ...monoSx,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-all',
            }}
            component="pre"
          >
            {JSON.stringify(data, null, 2)}
          </Box>
        </Collapse>
      </Box>
    </Box>
  );
}

function FileList({
  label,
  files,
  color,
  joinPath,
}: {
  label: string;
  files: string[];
  color: string;
  joinPath: (rel: string) => string;
}) {
  return (
    <Box>
      <Typography variant="caption" color="text.secondary" fontWeight={600} sx={{ display: 'block', mb: 0.5 }}>
        {label}
        <Typography component="span" variant="caption" sx={{ ml: 0.5, color }}>
          ({files.length})
        </Typography>
      </Typography>
      <Box
        sx={{
          p: 1,
          bgcolor: 'action.hover',
          borderRadius: 1,
          borderLeft: `3px solid ${color}`,
          maxHeight: 180,
          overflow: 'auto',
        }}
      >
        {files.map((file) => (
          <Typography
            key={file}
            variant="caption"
            sx={{ ...monoSx, display: 'block', wordBreak: 'break-all', py: 0.25 }}
          >
            {joinPath(file)}
          </Typography>
        ))}
      </Box>
    </Box>
  );
}
