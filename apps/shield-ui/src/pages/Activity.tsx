/**
 * Activity page - full activity history with filters and CSS Grid table layout
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
} from '@mui/material';
import type { SelectChangeEvent } from '@mui/material';
import {
  Activity as ActivityIcon,
  Trash2,
  ChevronRight,
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
  getEventColor,
  getEventStatus,
  EVENT_DISPLAY,
  BLOCKED_EVENT_TYPES,
} from '../utils/eventDisplay';
import { StatusBadge } from '../components/shared/StatusBadge';

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

const GRID_COLUMNS = '28px 90px 150px 1fr 90px';
const ROW_HEIGHT = 44;
const EXPANDED_EXTRA = 300;

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
  return event.type.startsWith(`${filter}:`);
}

export function Activity() {
  const theme = useTheme();
  const guard = useGuardedAction();
  const { events } = useSnapshot(eventStore);
  const [search, setSearch] = useState('');
  const [timeFilter, setTimeFilter] = useState<TimeFilter>('all');
  const [typeFilters, setTypeFilters] = useState<TypeFilter[]>([]);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const parentRef = useRef<HTMLDivElement>(null);

  const handleTypeFilterChange = useCallback((e: SelectChangeEvent<TypeFilter[]>) => {
    const val = e.target.value;
    setTypeFilters(typeof val === 'string' ? val.split(',') as TypeFilter[] : val);
  }, []);

  const toggleExpand = useCallback((id: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const filteredEvents = useMemo(() => {
    let result = [...events] as SSEEvent[];

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
  }, [events, timeFilter, typeFilters, search]);

  const virtualizer = useVirtualizer({
    count: filteredEvents.length,
    getScrollElement: () => parentRef.current,
    estimateSize: (index) => {
      const event = filteredEvents[index];
      return expandedIds.has(event.id) ? ROW_HEIGHT + EXPANDED_EXTRA : ROW_HEIGHT;
    },
    overscan: 10,
  });

  useEffect(() => {
    virtualizer.measure();
  }, [expandedIds, virtualizer]);

  return (
    <Box sx={{ maxWidth: tokens.page.maxWidth, mx: 'auto' }}>
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

      <Box sx={{ display: 'flex', gap: 2, mb: 3, alignItems: 'center' }}>
        <Box sx={{ flex: 1 }}>
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
          sx={{ minWidth: 180, height: 40, '& .MuiSelect-select': { py: 0.75 } }}
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
          sx={{ minWidth: 140, height: 40 }}
        >
          {TIME_OPTIONS.map((opt) => (
            <MenuItem key={opt.value} value={opt.value}>{opt.label}</MenuItem>
          ))}
        </Select>
        {typeFilters.length > 0 && (
          <Chip
            label="Clear filters"
            size="small"
            onDelete={() => setTypeFilters([])}
            sx={{ height: 28 }}
          />
        )}
      </Box>

      {events.length === 0 ? (
        <Box sx={{ p: 4 }}>
          <EmptyState
            icon={<ActivityIcon size={28} />}
            title="No activity yet"
            description="Events will appear here as they are received from the daemon via SSE."
          />
        </Box>
      ) : filteredEvents.length === 0 ? (
        <Box sx={{ p: 4 }}>
          <EmptyState
            title="No matching events"
            description="Try adjusting your filters or search query."
          />
        </Box>
      ) : (
        <Box
          ref={parentRef}
          sx={{
            maxHeight: 'calc(100vh - 280px)',
            overflow: 'auto',
            border: '1px solid',
            borderColor: 'divider',
            borderRadius: 2,
          }}
        >
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
              position: 'sticky',
              top: 0,
              zIndex: 1,
            }}
          >
            <Box />
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
              Status
            </Typography>
          </Box>

          <div style={{ height: virtualizer.getTotalSize(), width: '100%', position: 'relative' }}>
            {virtualizer.getVirtualItems().map(virtualRow => {
              const event = filteredEvents[virtualRow.index];
              const display = getEventDisplay(event.type);
              const IconComp = display.icon;
              const eventColor = getEventColor(event);
              const color = resolveEventColor(eventColor, theme.palette);
              const status = getEventStatus(event);
              const isExpanded = expandedIds.has(event.id);

              return (
                <Box
                  key={virtualRow.key}
                  sx={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    transform: `translateY(${virtualRow.start}px)`,
                    borderBottom: '1px solid',
                    borderColor: 'divider',
                    cursor: 'pointer',
                    '&:hover': { bgcolor: 'action.hover' },
                  }}
                  onClick={() => toggleExpand(event.id)}
                >
                  {/* Grid row */}
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
                    {/* Chevron */}
                    <ChevronRight
                      size={14}
                      style={{
                        flexShrink: 0,
                        transition: 'transform 0.15s ease',
                        transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)',
                        color: theme.palette.text.disabled,
                      }}
                    />

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
                      {getEventSummary(event)}
                    </Typography>

                    {/* Status badge — matches policy allow/deny style */}
                    <StatusBadge
                      label={status.label}
                      variant={status.variant}
                      dot={false}
                      size="small"
                    />
                  </Box>

                  {/* Expanded JSON panel */}
                  {isExpanded && (
                    <Box
                      sx={{
                        maxHeight: EXPANDED_EXTRA,
                        overflow: 'auto',
                        mx: 2,
                        mb: 1,
                        p: 1.5,
                        bgcolor: 'action.hover',
                        borderRadius: 1,
                        fontFamily: '"IBM Plex Mono", monospace',
                        fontSize: '0.75rem',
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-all',
                      }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Typography variant="caption" color="text.disabled" sx={{ display: 'block', mb: 0.5, fontFamily: 'inherit' }}>
                        ID: {event.id} | {format(event.timestamp, 'yyyy-MM-dd HH:mm:ss.SSS')}
                      </Typography>
                      {JSON.stringify(event.data, null, 2)}
                    </Box>
                  )}
                </Box>
              );
            })}
          </div>
        </Box>
      )}

      {filteredEvents.length > 0 && (
        <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block', textAlign: 'center' }}>
          Showing {filteredEvents.length} of {events.length} events
        </Typography>
      )}
    </Box>
  );
}
