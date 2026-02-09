/**
 * Persistent sidebar navigation component
 * Includes branding, connection status, and theme toggle (no top bar)
 */

import { useLocation, useNavigate } from 'react-router-dom';
import {
  Drawer,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Divider,
  Box,
  Typography,
  IconButton,
  Tooltip,
  Chip,
  Button,
  CircularProgress,
} from '@mui/material';
import {
  LayoutDashboard,
  ShieldCheck,
  Zap,
  KeyRound,
  Settings,
  Shield,
  Moon,
  Sun,
  Wifi,
  WifiOff,
  Menu,
  RefreshCw,
  Plug,
  Activity,
  AlertTriangle,
  ExternalLink,
} from 'lucide-react';
import { tokens } from '../../styles/tokens';
import { useSnapshot } from 'valtio';
import { eventStore } from '../../state/events';
import { useStatus, useOpenClawDashboardUrl } from '../../api/hooks';
import { notify } from '../../stores/notifications';

const DRAWER_WIDTH = tokens.sidebar.width;

interface SidebarProps {
  open: boolean;
  onClose: () => void;
  darkMode: boolean;
  onToggleDarkMode: () => void;
  onMenuClick: () => void;
  disconnected?: boolean;
  onReconnect?: () => void;
  reconnecting?: boolean;
}

const menuItems = [
  { path: '/', label: 'Overview', icon: <LayoutDashboard size={20} /> },
  { path: '/policies', label: 'Policies', icon: <ShieldCheck size={20} /> },
  { path: '/skills', label: 'Skills', icon: <Zap size={20} /> },
  { path: '/secrets', label: 'Secrets', icon: <KeyRound size={20} /> },
  { path: '/activity', label: 'Activity', icon: <Activity size={20} /> },
  { path: '/integrations', label: 'Integrations', icon: <Plug size={20} /> },
  { path: '/settings', label: 'Settings', icon: <Settings size={20} /> },
];

export function Sidebar({
  open,
  onClose,
  darkMode,
  onToggleDarkMode,
  onMenuClick,
  disconnected,
  onReconnect,
  reconnecting,
}: SidebarProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const { connected: sseConnected } = useSnapshot(eventStore);
  const { data: status } = useStatus();
  const openClawDashboard = useOpenClawDashboardUrl();

  const handleNavigation = (path: string) => {
    navigate(path);
    onClose();
  };

  const handleOpenClawClick = () => {
    openClawDashboard.mutate(undefined, {
      onSuccess: (data) => {
        if (data.data?.url) {
          window.open(data.data.url, '_blank');
        } else {
          notify.error('Could not get OpenClaw dashboard URL');
        }
      },
      onError: (error) => {
        notify.error(error.message || 'Failed to open OpenClaw dashboard');
      },
    });
  };

  const drawerContent = (
    <Box sx={{ overflow: 'auto', height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Branding + controls */}
      <Box sx={{ px: 2, py: 2, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Shield size={20} />
          <Typography variant="subtitle1">AgenShield</Typography>
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <Tooltip title={sseConnected ? 'Live connection active' : 'Live connection lost'}>
            <Box sx={{ display: 'flex', color: sseConnected ? 'success.main' : 'error.main' }}>
              {sseConnected ? <Wifi size={14} /> : <WifiOff size={14} />}
            </Box>
          </Tooltip>
          <IconButton size="small" onClick={onToggleDarkMode} sx={{ ml: 0.25 }}>
            {darkMode ? <Sun size={16} /> : <Moon size={16} />}
          </IconButton>
        </Box>
      </Box>

      <Divider />

      {/* Navigation */}
      <List sx={{ px: 1.5, pt: 1, flex: 1 }}>
        {menuItems.map((item) => (
          <ListItem key={item.path} disablePadding sx={{ mb: 0.5 }}>
            <ListItemButton
              selected={item.path === '/' ? location.pathname === '/' : location.pathname.startsWith(item.path)}
              onClick={() => handleNavigation(item.path)}
              sx={{
                px: 1,
                py: 0.25,
                '&:hover': {
                  bgcolor: (theme) => theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.06)' : 'grey.50',
                },
                '&.Mui-selected': {
                  bgcolor: (theme) => theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.1)' : 'grey.100',
                  color: (theme) => theme.palette.mode === 'dark' ? 'grey.50' : 'grey.900',
                  '& .MuiListItemIcon-root': {
                    color: 'inherit',
                  },
                  '&:hover': {
                    bgcolor: (theme) => theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.14)' : 'grey.200',
                  },
                },
              }}
            >
              <ListItemIcon sx={{ minWidth: 30 }}>{item.icon}</ListItemIcon>
              <ListItemText
                primary={item.label}
                primaryTypographyProps={{ variant: 'subtitle1' }}
              />
            </ListItemButton>
          </ListItem>
        ))}

        {/* OpenClaw external link */}
        <Divider sx={{ my: 1 }} />
        <ListItem disablePadding sx={{ mb: 0.5 }}>
          <ListItemButton
            onClick={handleOpenClawClick}
            disabled={openClawDashboard.isPending}
            sx={{
              px: 1,
              py: 0.25,
              '&:hover': {
                bgcolor: (theme) => theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.06)' : 'grey.50',
              },
            }}
          >
            <ListItemIcon sx={{ minWidth: 30 }}>
              {openClawDashboard.isPending ? (
                <CircularProgress size={18} sx={{ color: 'text.secondary' }} />
              ) : (
                <ExternalLink size={20} />
              )}
            </ListItemIcon>
            <ListItemText
              primary="OpenClaw"
              primaryTypographyProps={{ variant: 'subtitle1' }}
            />
          </ListItemButton>
        </ListItem>
      </List>

      {/* Footer */}
      <Divider />
      {disconnected || reconnecting ? (
        <Box
          sx={{
            m: 1.5,
            p: 1.5,
            display: 'flex',
            flexDirection: 'column',
            gap: 1.5,
            borderRadius: 1,
            bgcolor: (theme) => theme.palette.mode === 'dark' ? 'rgba(225,88,62,0.15)' : 'rgba(225,88,62,0.08)',
            border: (theme) => `1px solid ${theme.palette.error.main}`,
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1, color: 'error.main' }}>
            <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 2 }} />
            <Box>
              <Typography variant="body3" fontWeight={600} color="error.main">
                Unable to connect
              </Typography>
              <Typography variant="caption" sx={{ display: 'block', mt: 0.25, color: 'text.secondary' }}>
                Run <code>agenshield daemon start</code> to start it.
              </Typography>
            </Box>
          </Box>
          <Button
            size="small"
            variant="outlined"
            color="error"
            startIcon={reconnecting
              ? <CircularProgress size={14} color="error" />
              : <RefreshCw size={14} />
            }
            onClick={onReconnect}
            disabled={reconnecting}
            fullWidth
          >
            {reconnecting ? 'Connecting...' : 'Reconnect'}
          </Button>
        </Box>
      ) : (
        <Box sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 0.75 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <Typography variant="caption" color="text.secondary">
              AgenShield v0.1.0
            </Typography>
            {status?.data && (
              <Chip
                label={status.data.running ? 'Running' : 'Stopped'}
                color={status.data.running ? 'success' : 'error'}
                size="small"
                variant="outlined"
              />
            )}
          </Box>
          {status?.data?.openclaw && (
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <Typography variant="caption" color="text.secondary">
                OpenClaw Gateway
              </Typography>
              <Chip
                label={status.data.openclaw.gateway?.running ? 'Running' : 'Stopped'}
                color={status.data.openclaw.gateway?.running ? 'success' : 'error'}
                size="small"
                variant="outlined"
              />
            </Box>
          )}
        </Box>
      )}
    </Box>
  );

  return (
    <>
      {/* Permanent drawer for desktop */}
      <Drawer
        variant="permanent"
        sx={{
          display: { xs: 'none', md: 'block' },
          width: DRAWER_WIDTH,
          flexShrink: 0,
          '& .MuiDrawer-paper': {
            width: DRAWER_WIDTH,
            boxSizing: 'border-box',
            borderRight: (theme) => `1px solid ${theme.palette.divider}`,
            zIndex: tokens.zIndex.navigation,
          },
        }}
      >
        {drawerContent}
      </Drawer>

      {/* Temporary drawer for mobile */}
      <Drawer
        variant="temporary"
        open={open}
        onClose={onClose}
        ModalProps={{ keepMounted: true }}
        sx={{
          display: { xs: 'block', md: 'none' },
          '& .MuiDrawer-paper': {
            width: DRAWER_WIDTH,
            boxSizing: 'border-box',
            zIndex: tokens.zIndex.navigation,
          },
        }}
      >
        {drawerContent}
      </Drawer>
    </>
  );
}
