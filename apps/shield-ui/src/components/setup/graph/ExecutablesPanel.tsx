/**
 * Executables discovery panel — virtualized list of system binaries
 *
 * Shows protection status badges that evolve in real-time as setup steps complete.
 */

import { useState, useMemo, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useSnapshot } from 'valtio';
import {
  Box, Typography, TextField, Chip, InputAdornment, Tabs, Tab,
} from '@mui/material';
import { styled } from '@mui/material/styles';
import { Search } from 'lucide-react';
import { setupStore, type ExecutableInfo } from '../../../state/setup';
import { useExecutables } from '../../../api/setup';

// --- Styled ---

const PanelRoot = styled('div')(({ theme }) => ({
  display: 'flex',
  flexDirection: 'column',
  height: '100%',
  background: theme.palette.mode === 'dark' ? '#0f0f1a' : theme.palette.background.paper,
  borderRadius: 12,
  overflow: 'hidden',
  border: `1px solid ${theme.palette.divider}`,
}));

const ListContainer = styled('div')({
  flex: 1,
  overflowY: 'auto',
  padding: '0 4px',
});

// --- Category tabs ---

type CategoryFilter = 'all' | 'network' | 'package-manager' | 'shell' | 'system';

// --- Component ---

export function ExecutablesPanel() {
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<CategoryFilter>('all');
  const parentRef = useRef<HTMLDivElement>(null);

  const { completedEngineSteps } = useSnapshot(setupStore);
  const { data } = useExecutables();

  const executables: ExecutableInfo[] = useMemo(() => {
    if (!data?.data?.executables) return [];
    return data.data.executables;
  }, [data]);

  // Filter
  const filtered = useMemo(() => {
    let list = executables;
    if (category !== 'all') {
      list = list.filter(e => e.category === category);
    }
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(e => e.name.toLowerCase().includes(q) || e.path.toLowerCase().includes(q));
    }
    return list;
  }, [executables, category, search]);

  // Protection counts
  const protectedCount = useMemo(
    () => executables.filter(e => e.isProxied || e.isWrapped || e.isAllowed).length,
    [executables],
  );

  // Virtualizer
  const virtualizer = useVirtualizer({
    count: filtered.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 36,
    overscan: 20,
  });

  return (
    <PanelRoot>
      {/* Header */}
      <Box sx={{ px: 2, pt: 1.5, pb: 1, borderBottom: 1, borderColor: 'divider' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
          <Typography variant="subtitle2">System Executables</Typography>
          <Typography variant="caption" color="success.main" fontFamily="monospace">
            {protectedCount} of {executables.length.toLocaleString()} protected
          </Typography>
        </Box>
        <TextField
          size="small"
          fullWidth
          placeholder="Search executables..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          slotProps={{
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <Search size={14} />
                </InputAdornment>
              ),
            },
          }}
        />
      </Box>

      {/* Category tabs */}
      <Tabs
        value={category}
        onChange={(_, val) => setCategory(val)}
        variant="scrollable"
        scrollButtons={false}
        sx={{ minHeight: 36, px: 1, '& .MuiTab-root': { minHeight: 32, py: 0, textTransform: 'none', fontSize: 12 } }}
      >
        <Tab label="All" value="all" />
        <Tab label="Network" value="network" />
        <Tab label="Pkg Mgrs" value="package-manager" />
        <Tab label="Shell" value="shell" />
        <Tab label="System" value="system" />
      </Tabs>

      {/* Virtualized list */}
      <ListContainer ref={parentRef}>
        <div style={{ height: virtualizer.getTotalSize(), width: '100%', position: 'relative' }}>
          {virtualizer.getVirtualItems().map(virtualRow => {
            const exe = filtered[virtualRow.index];
            return (
              <Box
                key={virtualRow.key}
                sx={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  height: virtualRow.size,
                  transform: `translateY(${virtualRow.start}px)`,
                  display: 'flex',
                  alignItems: 'center',
                  px: 1.5,
                  gap: 1.5,
                  borderBottom: 1,
                  borderColor: 'divider',
                  '&:hover': { bgcolor: 'action.hover' },
                }}
              >
                <Typography variant="caption" fontFamily="monospace" fontWeight={500} sx={{ minWidth: 120 }}>
                  {exe.name}
                </Typography>
                <Typography
                  variant="caption"
                  color="text.secondary"
                  fontFamily="monospace"
                  sx={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                >
                  {exe.path}
                </Typography>
                {exe.isProxied ? (
                  <Chip label="Proxied" size="small" color="success" variant="outlined" sx={{ height: 20, fontSize: 10 }} />
                ) : exe.isWrapped ? (
                  <Chip label="Wrapped" size="small" color="primary" variant="outlined" sx={{ height: 20, fontSize: 10 }} />
                ) : exe.isAllowed ? (
                  <Chip label="Allowed" size="small" color="secondary" variant="outlined" sx={{ height: 20, fontSize: 10 }} />
                ) : (
                  <Typography variant="caption" color="text.disabled">--</Typography>
                )}
              </Box>
            );
          })}
        </div>
      </ListContainer>
    </PanelRoot>
  );
}
