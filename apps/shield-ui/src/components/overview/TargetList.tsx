/**
 * TargetList — clickable sidebar listing sources for filtering the activity log.
 *
 * Entries: "All", "Daemon", "System", then per-target from useTargets().
 * Each entry shows a status dot and event count badge.
 */

import { memo, useMemo } from 'react';
import { Box, Typography, List, ListItemButton, ListItemText, Chip } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { Circle, Server, Monitor, Layers } from 'lucide-react';
import { useSnapshot } from 'valtio';
import { eventStore } from '../../state/events';
import { useTargets } from '../../api/targets';
import { isNoiseEvent } from '../../utils/eventDisplay';

interface TargetListProps {
  selected: string;
  onSelect: (source: string) => void;
}

interface SourceEntry {
  id: string;
  label: string;
  icon: typeof Server;
  color?: string;
  count: number;
}

export const TargetList = memo(({ selected, onSelect }: TargetListProps) => {
  const theme = useTheme();
  const { events } = useSnapshot(eventStore);
  const { data: targetsRes } = useTargets();
  const targets = targetsRes?.data ?? [];

  const entries: SourceEntry[] = useMemo(() => {
    // Count events per source
    const counts = new Map<string, number>();
    let total = 0;
    for (const e of events) {
      if (isNoiseEvent(e)) continue;
      total++;
      const src = e.source ?? 'daemon';
      counts.set(src, (counts.get(src) ?? 0) + 1);
    }

    const result: SourceEntry[] = [
      { id: 'all', label: 'All', icon: Layers, count: total },
      { id: 'daemon', label: 'Daemon', icon: Server, color: theme.palette.info.main, count: counts.get('daemon') ?? 0 },
      { id: 'system', label: 'System', icon: Monitor, color: theme.palette.warning.main, count: counts.get('system') ?? 0 },
    ];

    for (const t of targets) {
      result.push({
        id: t.id,
        label: t.name,
        icon: Circle,
        color: t.shielded ? theme.palette.success.main : theme.palette.text.disabled,
        count: counts.get(t.id) ?? 0,
      });
    }

    return result;
  }, [events, targets, theme]);

  return (
    <Box sx={{
      minWidth: 180,
      maxWidth: 220,
      borderRight: '1px solid',
      borderColor: 'divider',
      overflow: 'auto',
    }}>
      <Typography
        variant="caption"
        fontWeight={700}
        sx={{
          px: 2,
          pt: 1.5,
          pb: 0.5,
          display: 'block',
          textTransform: 'uppercase',
          letterSpacing: 0.5,
          color: 'text.secondary',
        }}
      >
        Sources
      </Typography>
      <List dense disablePadding>
        {entries.map((entry) => {
          const Icon = entry.icon;
          const isSelected = selected === entry.id;
          return (
            <ListItemButton
              key={entry.id}
              selected={isSelected}
              onClick={() => onSelect(entry.id)}
              sx={{ px: 2, py: 0.5, borderRadius: 0 }}
            >
              <Icon
                size={10}
                fill={entry.color ?? 'transparent'}
                color={entry.color ?? theme.palette.text.secondary}
                style={{ marginRight: 8, flexShrink: 0 }}
              />
              <ListItemText
                primary={entry.label}
                primaryTypographyProps={{
                  variant: 'body2',
                  fontWeight: isSelected ? 600 : 400,
                  noWrap: true,
                }}
              />
              {entry.count > 0 && (
                <Chip
                  label={entry.count > 999 ? '999+' : entry.count}
                  size="small"
                  sx={{
                    height: 18,
                    minWidth: 28,
                    fontSize: 10,
                    fontWeight: 600,
                    '& .MuiChip-label': { px: 0.75 },
                  }}
                />
              )}
            </ListItemButton>
          );
        })}
      </List>
    </Box>
  );
});
TargetList.displayName = 'TargetList';
