/**
 * Activity page - full activity history with filters
 */

import { useState, useMemo } from 'react';
import {
  Box,
  Card,
  CardContent,
  Select,
  MenuItem,
  Typography,
  Chip,
  Skeleton,
  Button,
} from '@mui/material';
import {
  Activity as ActivityIcon,
  Globe,
  ShieldAlert,
  ArrowRightLeft,
  ArrowUpRight,
  Settings as SettingsIcon,
  Trash2,
  Link2,
} from 'lucide-react';
import { useTheme } from '@mui/material/styles';
import { formatDistanceToNow, format, isAfter, subHours, subDays } from 'date-fns';
import { useSnapshot } from 'valtio';
import { eventStore, clearEvents, type SSEEvent } from '../state/events';
import { tokens } from '../styles/tokens';
import { PageHeader } from '../components/shared/PageHeader';
import { SearchInput } from '../components/shared/SearchInput';
import { EmptyState } from '../components/shared/EmptyState';
import { useAuth } from '../context/AuthContext';

type TimeFilter = 'all' | '1h' | '6h' | '24h' | '7d';
type TypeFilter = 'all' | 'api' | 'security' | 'broker' | 'config' | 'skills' | 'exec' | 'agentlink';

const TIME_OPTIONS: { label: string; value: TimeFilter }[] = [
  { label: 'All Time', value: 'all' },
  { label: 'Last Hour', value: '1h' },
  { label: 'Last 6 Hours', value: '6h' },
  { label: 'Last 24 Hours', value: '24h' },
  { label: 'Last 7 Days', value: '7d' },
];

const TYPE_OPTIONS: { label: string; value: TypeFilter }[] = [
  { label: 'All Types', value: 'all' },
  { label: 'API Requests', value: 'api' },
  { label: 'Security', value: 'security' },
  { label: 'Broker', value: 'broker' },
  { label: 'Config', value: 'config' },
  { label: 'Skills', value: 'skills' },
  { label: 'Execution', value: 'exec' },
  { label: 'AgentLink', value: 'agentlink' },
];

const EVENT_DISPLAY: Record<string, { icon: React.ComponentType<{ size?: number }>; label: string; color: string }> = {
  'api:request': { icon: Globe, label: 'API Request', color: 'primary' },
  'api:outbound': { icon: ArrowUpRight, label: 'Outbound Request', color: 'info' },
  'security:status': { icon: ShieldAlert, label: 'Security Status', color: 'warning' },
  'security:alert': { icon: ShieldAlert, label: 'Security Alert', color: 'error' },
  'broker:request': { icon: ArrowRightLeft, label: 'Broker Request', color: 'info' },
  'broker:response': { icon: ArrowRightLeft, label: 'Broker Response', color: 'info' },
  'config:changed': { icon: SettingsIcon, label: 'Config Changed', color: 'secondary' },
  'skills:quarantined': { icon: ShieldAlert, label: 'Skill Quarantined', color: 'warning' },
  'skills:approved': { icon: ShieldAlert, label: 'Skill Approved', color: 'success' },
  'exec:monitored': { icon: Globe, label: 'Exec Monitored', color: 'info' },
  'exec:denied': { icon: ShieldAlert, label: 'Exec Denied', color: 'error' },
  'agentlink:connected': { icon: Link2, label: 'AgentLink Connected', color: 'success' },
  'agentlink:disconnected': { icon: Link2, label: 'AgentLink Disconnected', color: 'error' },
  'agentlink:auth_required': { icon: Link2, label: 'Auth Required', color: 'warning' },
  'agentlink:auth_completed': { icon: Link2, label: 'Auth Completed', color: 'success' },
  'agentlink:tool_executed': { icon: Link2, label: 'Tool Executed', color: 'info' },
  'agentlink:error': { icon: Link2, label: 'AgentLink Error', color: 'error' },
};

function getEventDisplay(event: SSEEvent) {
  return EVENT_DISPLAY[event.type] ?? { icon: Globe, label: event.type, color: 'primary' };
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

function getEventSummary(event: SSEEvent): string {
  if (event.type === 'api:outbound') {
    const d = event.data as Record<string, unknown>;
    const ctx = d.context ?? '';
    const status = d.statusCode ?? '';
    const url = d.url ?? '';
    return `${ctx} [${status}] ${url}`;
  }
  return (event.data?.message as string) ??
    (event.data?.url as string) ??
    (event.data?.method as string) ??
    (event.data?.name as string) ??
    (event.data?.integration as string) ??
    JSON.stringify(event.data).slice(0, 120);
}

export function Activity() {
  const theme = useTheme();
  const { isReadOnly } = useAuth();
  const { events } = useSnapshot(eventStore);
  const [search, setSearch] = useState('');
  const [timeFilter, setTimeFilter] = useState<TimeFilter>('all');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');

  const filteredEvents = useMemo(() => {
    let result = [...events] as SSEEvent[];

    // Time filter
    const threshold = getTimeThreshold(timeFilter);
    if (threshold) {
      result = result.filter((e) => isAfter(e.timestamp, threshold));
    }

    // Type filter
    if (typeFilter !== 'all') {
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

  const colorForType = (color: string): string => {
    switch (color) {
      case 'error': return theme.palette.error.main;
      case 'warning': return theme.palette.warning.main;
      case 'success': return theme.palette.success.main;
      case 'info': return theme.palette.info.main;
      case 'secondary': return theme.palette.text.secondary;
      default: return theme.palette.primary.main;
    }
  };

  return (
    <Box sx={{ maxWidth: tokens.page.maxWidth, mx: 'auto' }}>
      <PageHeader
        title="Activity"
        description="View real-time event history from the daemon."
        action={
          !isReadOnly && events.length > 0 ? (
            <Button
              size="small"
              variant="outlined"
              color="secondary"
              startIcon={<Trash2 size={14} />}
              onClick={() => clearEvents()}
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
        <CardContent>
          {events.length === 0 ? (
            <EmptyState
              icon={<ActivityIcon size={28} />}
              title="No activity yet"
              description="Events will appear here as they are received from the daemon via SSE."
            />
          ) : filteredEvents.length === 0 ? (
            <EmptyState
              title="No matching events"
              description="Try adjusting your filters or search query."
            />
          ) : (
            <Box sx={{ display: 'flex', flexDirection: 'column' }}>
              {filteredEvents.map((event) => {
                const display = getEventDisplay(event);
                const IconComp = display.icon;
                const color = colorForType(display.color);

                return (
                  <Box
                    key={event.id}
                    sx={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: 1.5,
                      py: 1.5,
                      borderBottom: `1px solid`,
                      borderColor: 'divider',
                      '&:last-child': { borderBottom: 'none' },
                    }}
                  >
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
                        mt: '2px',
                      }}
                    >
                      <IconComp size={14} />
                    </Box>
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.25 }}>
                        <Typography variant="body2" fontWeight={500}>
                          {display.label}
                        </Typography>
                        <Chip
                          label={event.type}
                          size="small"
                          variant="outlined"
                          sx={{ height: 18, '& .MuiChip-label': { fontSize: '0.625rem', px: 0.75 } }}
                        />
                      </Box>
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        sx={{
                          display: 'block',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {getEventSummary(event)}
                      </Typography>
                    </Box>
                    <Box sx={{ flexShrink: 0, textAlign: 'right' }}>
                      <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                        {formatDistanceToNow(event.timestamp, { addSuffix: true })}
                      </Typography>
                      <Typography variant="caption" color="text.disabled" sx={{ fontSize: '0.625rem' }}>
                        {format(event.timestamp, 'HH:mm:ss')}
                      </Typography>
                    </Box>
                  </Box>
                );
              })}
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
