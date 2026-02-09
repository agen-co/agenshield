/**
 * Activity page - full activity history with filters
 */

import { useState, useMemo, useRef, useCallback, useEffect } from 'react';
import {
  Box,
  Card,
  CardContent,
  Select,
  MenuItem,
  Typography,
  Chip,
  Button,
} from '@mui/material';
import {
  Activity as ActivityIcon,
  Trash2,
  ChevronRight,
} from 'lucide-react';
import { useTheme } from '@mui/material/styles';
import { formatDistanceToNow, format, isAfter, subHours, subDays } from 'date-fns';
import { useSnapshot } from 'valtio';
import { useVirtualizer } from '@tanstack/react-virtual';
import { eventStore, clearEvents, type SSEEvent } from '../state/events';
import { tokens } from '../styles/tokens';
import { PageHeader } from '../components/shared/PageHeader';
import { SearchInput } from '../components/shared/SearchInput';
import { EmptyState } from '../components/shared/EmptyState';
import { useGuardedAction } from '../hooks/useGuardedAction';
import { getEventDisplay, resolveEventColor, EVENT_DISPLAY, BLOCKED_EVENT_TYPES } from '../utils/eventDisplay';

type TimeFilter = 'all' | '1h' | '6h' | '24h' | '7d';
type TypeFilter = 'all' | 'blocked' | 'api' | 'security' | 'broker' | 'config' | 'skills' | 'exec' | 'agenco' | 'wrappers' | 'process' | 'interceptor';

const TIME_OPTIONS: { label: string; value: TimeFilter }[] = [
  { label: 'All Time', value: 'all' },
  { label: 'Last Hour', value: '1h' },
  { label: 'Last 6 Hours', value: '6h' },
  { label: 'Last 24 Hours', value: '24h' },
  { label: 'Last 7 Days', value: '7d' },
];

const TYPE_OPTIONS: { label: string; value: TypeFilter }[] = [
  { label: 'All Types', value: 'all' },
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

function getEventSummary(event: SSEEvent): string {
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
    (d.integration as string) ??
    JSON.stringify(d).slice(0, 120);
}

const ROW_HEIGHT = 52;
const EXPANDED_HEIGHT = 352;

export function Activity() {
  const theme = useTheme();
  const guard = useGuardedAction();
  const { events } = useSnapshot(eventStore);
  const [search, setSearch] = useState('');
  const [timeFilter, setTimeFilter] = useState<TimeFilter>('all');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const parentRef = useRef<HTMLDivElement>(null);

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

    // Time filter
    const threshold = getTimeThreshold(timeFilter);
    if (threshold) {
      result = result.filter((e) => isAfter(e.timestamp, threshold));
    }

    // Type filter
    if (typeFilter === 'blocked') {
      result = result.filter((e) => isBlockedEvent(e));
    } else if (typeFilter !== 'all') {
      result = result.filter((e) => e.type.startsWith(`${typeFilter}:`));
    }

    // Search filter
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter((e) => {
        const summary = getEventSummary(e).toLowerCase();
        const label = (EVENT_DISPLAY[e.type]?.label ?? e.type).toLowerCase();
        return summary.includes(q) || label.includes(q) || e.type.includes(q);
      });
    }

    return result;
  }, [events, timeFilter, typeFilter, search]);

  const virtualizer = useVirtualizer({
    count: filteredEvents.length,
    getScrollElement: () => parentRef.current,
    estimateSize: (index) => {
      const event = filteredEvents[index];
      return expandedIds.has(event.id) ? EXPANDED_HEIGHT : ROW_HEIGHT;
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
        <Select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value as TypeFilter)}
          size="small"
          displayEmpty
          sx={{ minWidth: 160, height: 40 }}
        >
          {TYPE_OPTIONS.map((opt) => (
            <MenuItem key={opt.value} value={opt.value}>{opt.label}</MenuItem>
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
      </Box>

      <Card>
        <CardContent sx={{ p: 0, '&:last-child': { pb: 0 } }}>
          {events.length === 0 ? (
            <Box sx={{ p: 2 }}>
              <EmptyState
                icon={<ActivityIcon size={28} />}
                title="No activity yet"
                description="Events will appear here as they are received from the daemon via SSE."
              />
            </Box>
          ) : filteredEvents.length === 0 ? (
            <Box sx={{ p: 2 }}>
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
              }}
            >
              <div style={{ height: virtualizer.getTotalSize(), width: '100%', position: 'relative' }}>
                {virtualizer.getVirtualItems().map(virtualRow => {
                  const event = filteredEvents[virtualRow.index];
                  const display = getEventDisplay(event.type);
                  const IconComp = display.icon;
                  const color = resolveEventColor(display.color, theme.palette);
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
                        px: 2,
                      }}
                      onClick={() => toggleExpand(event.id)}
                    >
                      <Box
                        sx={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 1.5,
                          height: ROW_HEIGHT,
                        }}
                      >
                        <ChevronRight
                          size={14}
                          style={{
                            flexShrink: 0,
                            transition: 'transform 0.15s ease',
                            transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)',
                            color: theme.palette.text.disabled,
                          }}
                        />
                        <Box
                          sx={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            width: 28,
                            height: 28,
                            borderRadius: '6px',
                            backgroundColor: `${color}14`,
                            color,
                            flexShrink: 0,
                          }}
                        >
                          <IconComp size={14} />
                        </Box>
                        <Box sx={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 1 }}>
                          <Typography variant="body2" fontWeight={500} sx={{ flexShrink: 0 }}>
                            {display.label}
                          </Typography>
                          <Chip
                            label={event.type}
                            size="small"
                            variant="outlined"
                            sx={{ height: 18, '& .MuiChip-label': { fontSize: '0.625rem', px: 0.75 } }}
                          />
                          <Typography
                            variant="caption"
                            color="text.secondary"
                            sx={{
                              flex: 1,
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                              minWidth: 0,
                            }}
                          >
                            {getEventSummary(event)}
                          </Typography>
                        </Box>
                        <Box sx={{ flexShrink: 0, textAlign: 'right' }}>
                          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', whiteSpace: 'nowrap' }}>
                            {formatDistanceToNow(event.timestamp, { addSuffix: true })}
                          </Typography>
                          <Typography variant="caption" color="text.disabled" sx={{ fontSize: '0.625rem' }}>
                            {format(event.timestamp, 'HH:mm:ss')}
                          </Typography>
                        </Box>
                      </Box>

                      {isExpanded && (
                        <Box
                          sx={{
                            maxHeight: 300,
                            overflow: 'auto',
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
        </CardContent>
      </Card>

      {filteredEvents.length > 0 && (
        <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block', textAlign: 'center' }}>
          Showing {filteredEvents.length} of {events.length} events
        </Typography>
      )}
    </Box>
  );
}
