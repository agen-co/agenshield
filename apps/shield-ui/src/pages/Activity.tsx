/**
 * Activity page - full activity history with filters and CSS Grid table layout.
 *
 * Supports two modes:
 *  - Standalone (default): full page layout with PageHeader and maxHeight table
 *  - Embedded (in Overview): compact filters, fillHeight, click-to-select with detail panel
 */

import { useState, useMemo, useRef, useCallback, useEffect } from 'react';
import {
  Box,
  Select,
  MenuItem,
  Typography,
  Chip,
  Button,
  Checkbox,
  ListItemText,
  FormControlLabel,
  alpha,
} from '@mui/material';
import type { SelectChangeEvent } from '@mui/material';
import {
  Activity as ActivityIcon,
  Trash2,
  ArrowUp,
} from 'lucide-react';
import { useTheme } from '@mui/material/styles';
import { format, isAfter, subHours, subDays } from 'date-fns';
import { useSnapshot } from 'valtio';
import { useVirtualizer } from '@tanstack/react-virtual';
import { eventStore, clearEvents, type SSEEvent } from '../state/events';
import { tokens } from '../styles/tokens';
import { PageHeader } from '../components/shared/PageHeader';
import { SearchInput } from '../components/shared/SearchInput';
import { EmptyState } from '../components/shared/EmptyState';
import { useGuardedAction } from '../hooks/useGuardedAction';
import {
  getEventDisplay,
  resolveEventColor,
  getEventSummary,
  resolveTargetNames,
  getEventColor,
  getEventStatus,
  getEventSeverity,
  isNoiseEvent,
  EVENT_DISPLAY,
  BLOCKED_EVENT_TYPES,
  SEVERITY_COLORS,
} from '../utils/eventDisplay';
import { useProfiles } from '../api/hooks';
import { StatusBadge } from '../components/shared/StatusBadge';
import { EventDetailPanel } from '../components/overview/EventDetailPanel';

type TimeFilter = 'all' | '1h' | '6h' | '24h' | '7d';
type TypeFilter = 'blocked' | 'api' | 'security' | 'broker' | 'config' | 'skills' | 'exec' | 'agenco' | 'wrappers' | 'process' | 'interceptor';

const TIME_OPTIONS: { label: string; value: TimeFilter }[] = [
  { label: 'All Time', value: 'all' },
  { label: 'Last Hour', value: '1h' },
  { label: 'Last 6 Hours', value: '6h' },
  { label: 'Last 24 Hours', value: '24h' },
  { label: 'Last 7 Days', value: '7d' },
];

const TYPE_OPTIONS: { label: string; value: TypeFilter }[] = [
  { label: 'Blocked / Denied', value: 'blocked' },
  { label: 'API Requests', value: 'api' },
  { label: 'Security', value: 'security' },
  { label: 'Broker', value: 'broker' },
  { label: 'Config', value: 'config' },
  { label: 'Skills', value: 'skills' },
  { label: 'Execution', value: 'exec' },
  { label: 'AgenCo', value: 'agenco' },
  { label: 'Wrappers', value: 'wrappers' },
  { label: 'Process', value: 'process' },
  { label: 'Interceptor', value: 'interceptor' },
];

const GRID_COLUMNS = '90px 150px 1fr 60px 60px';
const ROW_HEIGHT = 44;

export interface ActivityProps {
  embedded?: boolean;
  sourceFilter?: string;
  profileId?: string;
  selectedEventId?: string | null;
  onSelectEvent?: (event: SSEEvent | null) => void;
  fillHeight?: boolean;
}

function getTimeThreshold(filter: TimeFilter): Date | null {
  if (filter === 'all') return null;
  const now = new Date();
  switch (filter) {
    case '1h': return subHours(now, 1);
    case '6h': return subHours(now, 6);
    case '24h': return subHours(now, 24);
    case '7d': return subDays(now, 7);
  }
}

function isBlockedEvent(event: SSEEvent): boolean {
  if (BLOCKED_EVENT_TYPES.has(event.type)) return true;
  if (event.type === 'interceptor:event') {
    const d = event.data as Record<string, unknown>;
    return d.type === 'denied' || d.type === 'deny';
  }
  return false;
}

function matchesTypeFilter(event: SSEEvent, filter: TypeFilter): boolean {
  if (filter === 'blocked') return isBlockedEvent(event);
  if (filter === 'process' && event.type === 'daemon:status') return true;
  return event.type.startsWith(`${filter}:`);
}

export function Activity({
  embedded,
  sourceFilter,
  profileId: profileIdFilter,
  selectedEventId,
  onSelectEvent,
  fillHeight,
}: ActivityProps) {
  const theme = useTheme();
  const guard = useGuardedAction();
  const { events } = useSnapshot(eventStore);
  const { data: profilesData } = useProfiles();
  const targetNameMap = useMemo(() => {
    const profiles = profilesData?.data ?? [];
    const map = new Map<string, string>();
    for (const p of profiles as Array<{ id: string; name: string; targetName?: string }>) {
      if (p.targetName) map.set(p.targetName, p.name);
      map.set(p.id, p.name);
    }
    return map;
  }, [profilesData]);
  const [search, setSearch] = useState('');
  const [timeFilter, setTimeFilter] = useState<TimeFilter>('all');
  const [typeFilters, setTypeFilters] = useState<TypeFilter[]>([]);
  const [hideNoise, setHideNoise] = useState(true);
  const parentRef = useRef<HTMLDivElement>(null);

  // Internal selection state for standalone mode
  const [internalSelectedId, setInternalSelectedId] = useState<string | null>(null);

  // Use external or internal selection
  const activeSelectedId = onSelectEvent ? selectedEventId : internalSelectedId;
  const handleSelectEvent = useCallback((event: SSEEvent | null) => {
    if (onSelectEvent) {
      onSelectEvent(event);
    } else {
      setInternalSelectedId(event?.id ?? null);
    }
  }, [onSelectEvent]);

  // Find selected event object for standalone detail panel
  const selectedEvent = useMemo(() => {
    if (!activeSelectedId) return null;
    return (events as SSEEvent[]).find((e) => e.id === activeSelectedId) ?? null;
  }, [events, activeSelectedId]);

  // --- Event buffering ---
  const [pendingCount, setPendingCount] = useState(0);
  const [frozenLength, setFrozenLength] = useState<number | null>(null);
  const isScrolledRef = useRef(false);

  const handleTypeFilterChange = useCallback((e: SelectChangeEvent<TypeFilter[]>) => {
    const val = e.target.value;
    setTypeFilters(typeof val === 'string' ? val.split(',') as TypeFilter[] : val);
  }, []);

  const allFilteredEvents = useMemo(() => {
    let result = [...events] as SSEEvent[];

    if (sourceFilter && sourceFilter !== 'all') {
      result = result.filter((e) => (e.source ?? 'daemon') === sourceFilter);
    }

    if (profileIdFilter) {
      result = result.filter((e) => e.profileId === profileIdFilter);
    }

    if (hideNoise || embedded) {
      result = result.filter((e) => !isNoiseEvent(e));
    }

    const threshold = getTimeThreshold(timeFilter);
    if (threshold) {
      result = result.filter((e) => isAfter(e.timestamp, threshold));
    }

    if (typeFilters.length > 0) {
      result = result.filter((e) => typeFilters.some((f) => matchesTypeFilter(e, f)));
    }

    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter((e) => {
        const summary = getEventSummary(e).toLowerCase();
        const label = (EVENT_DISPLAY[e.type]?.label ?? e.type).toLowerCase();
        return summary.includes(q) || label.includes(q) || e.type.includes(q);
      });
    }

    return result;
  }, [events, sourceFilter, profileIdFilter, hideNoise, embedded, timeFilter, typeFilters, search]);

  // Visible events: buffer new events when scrolled down
  const visibleEvents = useMemo(() => {
    if (frozenLength === null) return allFilteredEvents;
    // Show only events up to the frozen snapshot length
    return allFilteredEvents.slice(0, frozenLength);
  }, [allFilteredEvents, frozenLength]);

  // Track new events arriving while frozen
  useEffect(() => {
    if (frozenLength !== null && allFilteredEvents.length > frozenLength) {
      setPendingCount(allFilteredEvents.length - frozenLength);
    }
  }, [allFilteredEvents.length, frozenLength]);

  const flushPending = useCallback(() => {
    setFrozenLength(null);
    setPendingCount(0);
    // Scroll to top
    parentRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  const handleScroll = useCallback(() => {
    const el = parentRef.current;
    if (!el) return;
    const scrollTop = el.scrollTop;

    if (scrollTop > 100 && !isScrolledRef.current) {
      // User scrolled down — freeze the event list
      isScrolledRef.current = true;
      setFrozenLength(allFilteredEvents.length);
    } else if (scrollTop < 50 && isScrolledRef.current) {
      // User scrolled back to top — flush pending
      isScrolledRef.current = false;
      setFrozenLength(null);
      setPendingCount(0);
    }
  }, [allFilteredEvents.length]);

  const virtualizer = useVirtualizer({
    count: visibleEvents.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 15,
  });

  const showStandalonePanel = !onSelectEvent && !!selectedEvent;

  return (
    <Box sx={embedded ? { display: 'flex', flexDirection: 'column', flex: fillHeight ? 1 : undefined, minHeight: 0 } : { maxWidth: tokens.page.maxWidth, mx: 'auto' }}>
      {!embedded && (
        <PageHeader
          title="Activity"
          description="View real-time event history from the daemon."
          action={
            events.length > 0 ? (
              <Button
                size="small"
                variant="outlined"
                color="secondary"
                startIcon={<Trash2 size={14} />}
                onClick={() => guard(() => clearEvents(), { description: 'Unlock to clear activity history.', actionLabel: 'Clear' })}
              >
                Clear
              </Button>
            ) : undefined
          }
        />
      )}

      {/* Filter bar */}
      <Box sx={{
        display: 'flex',
        gap: embedded ? 1 : 2,
        mb: embedded ? 1.5 : 3,
        alignItems: 'center',
        flexShrink: 0,
      }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Search events..."
          />
        </Box>
        <Select<TypeFilter[]>
          multiple
          value={typeFilters}
          onChange={handleTypeFilterChange}
          size="small"
          displayEmpty
          renderValue={(selected) =>
            selected.length === 0
              ? 'All Types'
              : selected.map((v) => TYPE_OPTIONS.find((o) => o.value === v)?.label ?? v).join(', ')
          }
          sx={{ minWidth: embedded ? 140 : 180, height: 36, '& .MuiSelect-select': { py: 0.75 } }}
        >
          {TYPE_OPTIONS.map((opt) => (
            <MenuItem key={opt.value} value={opt.value}>
              <Checkbox size="small" checked={typeFilters.includes(opt.value)} sx={{ p: 0, mr: 1 }} />
              <ListItemText primary={opt.label} primaryTypographyProps={{ variant: 'body2' }} />
            </MenuItem>
          ))}
        </Select>
        <Select
          value={timeFilter}
          onChange={(e) => setTimeFilter(e.target.value as TimeFilter)}
          size="small"
          displayEmpty
          sx={{ minWidth: embedded ? 110 : 140, height: 36 }}
        >
          {TIME_OPTIONS.map((opt) => (
            <MenuItem key={opt.value} value={opt.value}>{opt.label}</MenuItem>
          ))}
        </Select>
      </Box>

      {/* Noise filter row — hidden in embedded mode */}
      {!embedded && (
        <Box sx={{ display: 'flex', alignItems: 'center', mb: 2, flexShrink: 0 }}>
          <FormControlLabel
            control={
              <Checkbox
                size="small"
                checked={hideNoise}
                onChange={(e) => setHideNoise(e.target.checked)}
                sx={{ p: 0, mr: 0.75 }}
              />
            }
            label="Hide noise (system probes)"
            slotProps={{ typography: { variant: 'caption', color: 'text.secondary' } }}
            sx={{ ml: 0 }}
          />
          <Box sx={{ flex: 1 }} />
          {typeFilters.length > 0 && (
            <Chip
              label="Clear filters"
              size="small"
              onDelete={() => setTypeFilters([])}
              sx={{ height: 24 }}
            />
          )}
        </Box>
      )}

      {/* Main content area: table + optional standalone detail panel */}
      <Box sx={{
        display: 'flex',
        flex: fillHeight ? 1 : undefined,
        minHeight: 0,
        overflow: 'hidden',
      }}>
        {/* Table area */}
        <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          {events.length === 0 ? (
            <Box sx={{ p: 4 }}>
              <EmptyState
                icon={<ActivityIcon size={28} />}
                title="No activity yet"
                description="Events will appear here as they are received from the daemon via SSE."
              />
            </Box>
          ) : visibleEvents.length === 0 ? (
            <Box sx={{ p: 4 }}>
              <EmptyState
                title="No matching events"
                description="Try adjusting your filters or search query."
              />
            </Box>
          ) : (
            <Box
              sx={{
                display: 'flex',
                flexDirection: 'column',
                flex: fillHeight ? 1 : undefined,
                minHeight: 0,
                position: 'relative',
                border: '1px solid',
                borderColor: 'divider',
                borderRadius: 2,
                overflow: 'hidden',
              }}
            >
              {/* "N new events" floating button */}
              {pendingCount > 0 && (
                <Button
                  size="small"
                  variant="contained"
                  startIcon={<ArrowUp size={14} />}
                  onClick={flushPending}
                  sx={{
                    position: 'absolute',
                    top: 44,
                    left: '50%',
                    transform: 'translateX(-50%)',
                    zIndex: 2,
                    textTransform: 'none',
                    borderRadius: 4,
                    px: 2,
                    py: 0.25,
                    fontSize: 12,
                    boxShadow: 4,
                  }}
                >
                  {pendingCount} new event{pendingCount !== 1 ? 's' : ''}
                </Button>
              )}

              {/* Sticky table header */}
              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: GRID_COLUMNS,
                  alignItems: 'center',
                  gap: 1.5,
                  px: 2,
                  height: 36,
                  borderBottom: '1px solid',
                  borderColor: 'divider',
                  bgcolor: 'background.paper',
                  flexShrink: 0,
                }}
              >
                <Typography variant="caption" color="text.secondary" fontWeight={600}>
                  Time
                </Typography>
                <Typography variant="caption" color="text.secondary" fontWeight={600}>
                  Type
                </Typography>
                <Typography variant="caption" color="text.secondary" fontWeight={600}>
                  Details
                </Typography>
                <Typography variant="caption" color="text.secondary" fontWeight={600}>
                  Severity
                </Typography>
                <Typography variant="caption" color="text.secondary" fontWeight={600}>
                  Status
                </Typography>
              </Box>

              <Box
                ref={parentRef}
                onScroll={handleScroll}
                sx={{
                  flex: fillHeight ? 1 : undefined,
                  maxHeight: fillHeight ? undefined : 'calc(100vh - 280px)',
                  overflow: 'auto',
                  minHeight: 0,
                }}
              >
                <div style={{ height: virtualizer.getTotalSize(), width: '100%', position: 'relative' }}>
                  {virtualizer.getVirtualItems().map(virtualRow => {
                    const event = visibleEvents[virtualRow.index];
                    const display = getEventDisplay(event.type);
                    const IconComp = display.icon;
                    const eventColor = getEventColor(event);
                    const color = resolveEventColor(eventColor, theme.palette);
                    const status = getEventStatus(event);
                    const severity = getEventSeverity(event);
                    const isSelected = activeSelectedId === event.id;

                    return (
                      <Box
                        key={virtualRow.key}
                        data-index={virtualRow.index}
                        sx={{
                          position: 'absolute',
                          top: 0,
                          left: 0,
                          width: '100%',
                          height: ROW_HEIGHT,
                          transform: `translateY(${virtualRow.start}px)`,
                          borderBottom: '1px solid',
                          borderColor: 'divider',
                          cursor: 'pointer',
                          bgcolor: isSelected ? alpha(theme.palette.primary.main, 0.06) : undefined,
                          borderLeft: isSelected ? `3px solid ${theme.palette.primary.main}` : '3px solid transparent',
                          '&:hover': { bgcolor: isSelected ? alpha(theme.palette.primary.main, 0.08) : 'action.hover' },
                        }}
                        onClick={() => handleSelectEvent(isSelected ? null : event)}
                      >
                        <Box
                          sx={{
                            display: 'grid',
                            gridTemplateColumns: GRID_COLUMNS,
                            alignItems: 'center',
                            gap: 1.5,
                            height: ROW_HEIGHT,
                            px: 2,
                          }}
                        >
                          {/* Time */}
                          <Typography
                            variant="caption"
                            sx={{
                              fontFamily: '"IBM Plex Mono", monospace',
                              whiteSpace: 'nowrap',
                              color: 'text.secondary',
                            }}
                          >
                            {format(event.timestamp, 'HH:mm:ss')}
                          </Typography>

                          {/* Type — icon box + label */}
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
                            <Box
                              sx={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                width: 24,
                                height: 24,
                                borderRadius: '6px',
                                backgroundColor: `${color}14`,
                                color,
                                flexShrink: 0,
                              }}
                            >
                              <IconComp size={13} />
                            </Box>
                            <Typography
                              variant="caption"
                              fontWeight={500}
                              sx={{
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                              }}
                            >
                              {display.label}
                            </Typography>
                          </Box>

                          {/* Details */}
                          <Typography
                            variant="caption"
                            sx={{
                              fontFamily: '"IBM Plex Mono", monospace',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                              minWidth: 0,
                              color: 'text.secondary',
                            }}
                          >
                            {resolveTargetNames(getEventSummary(event), targetNameMap)}
                          </Typography>

                          {/* Severity */}
                          <Typography
                            variant="caption"
                            sx={{
                              color: SEVERITY_COLORS[severity],
                              fontWeight: 600,
                              fontSize: 11,
                              display: 'flex',
                              alignItems: 'center',
                              gap: 0.5,
                            }}
                          >
                            <Box
                              component="span"
                              sx={{
                                width: 6,
                                height: 6,
                                borderRadius: '50%',
                                bgcolor: SEVERITY_COLORS[severity],
                                flexShrink: 0,
                              }}
                            />
                            {severity}
                          </Typography>

                          {/* Status badge */}
                          <StatusBadge
                            label={status.label}
                            variant={status.variant}
                            dot={false}
                            size="small"
                          />
                        </Box>
                      </Box>
                    );
                  })}
                </div>
              </Box>
            </Box>
          )}

          {visibleEvents.length > 0 && !fillHeight && (
            <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block', textAlign: 'center', flexShrink: 0 }}>
              Showing {visibleEvents.length} of {events.length} events
            </Typography>
          )}
        </Box>

        {/* Standalone detail panel (non-embedded mode) */}
        {!embedded && (
          <EventDetailPanel
            event={selectedEvent}
            onClose={() => handleSelectEvent(null)}
          />
        )}
      </Box>
    </Box>
  );
}
