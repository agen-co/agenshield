/**
 * Header component with SSE connection indicator
 */

import {
  AppBar,
  Toolbar,
  Typography,
  IconButton,
  Box,
  Chip,
  Tooltip,
} from '@mui/material';
import {
  Menu,
  Moon,
  Sun,
  Shield,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { useStatus } from '../../api/hooks';
import { useEventStore } from '../../state/events';
import { tokens } from '../../styles/tokens';

interface HeaderProps {
  onMenuClick: () => void;
  darkMode: boolean;
  onToggleDarkMode: () => void;
}

export function Header({ onMenuClick, darkMode, onToggleDarkMode }: HeaderProps) {
  const { data: status } = useStatus();
  const sseConnected = useEventStore((s) => s.connected);

  return (
    <AppBar
      position="fixed"
      sx={{
        zIndex: tokens.zIndex.toolbar,
        bgcolor: 'background.paper',
        color: 'text.primary',
        boxShadow: 'none',
        borderBottom: (theme) => `1px solid ${theme.palette.divider}`,
        height: tokens.toolbar.height,
      }}
    >
      <Toolbar sx={{ minHeight: `${tokens.toolbar.height}px !important` }}>
        <IconButton
          edge="start"
          color="inherit"
          aria-label="menu"
          onClick={onMenuClick}
          sx={{ mr: 2, display: { md: 'none' } }}
        >
          <Menu size={20} />
        </IconButton>

        <Shield size={22} style={{ marginRight: 8 }} />
        <Typography variant="h6" component="div" sx={{ flexGrow: 1 }}>
          AgenShield
        </Typography>

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <Tooltip title={sseConnected ? 'Live connection active' : 'Live connection lost'}>
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 0.5,
                color: sseConnected ? 'success.main' : 'text.disabled',
              }}
            >
              {sseConnected ? <Wifi size={16} /> : <WifiOff size={16} />}
            </Box>
          </Tooltip>

          {status?.data && (
            <Chip
              label={status.data.running ? 'Running' : 'Stopped'}
              color={status.data.running ? 'success' : 'error'}
              size="small"
              variant="outlined"
            />
          )}

          <IconButton color="inherit" onClick={onToggleDarkMode} size="small">
            {darkMode ? <Sun size={18} /> : <Moon size={18} />}
          </IconButton>
        </Box>
      </Toolbar>
    </AppBar>
  );
}
