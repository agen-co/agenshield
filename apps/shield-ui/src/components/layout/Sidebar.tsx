/**
 * Persistent sidebar navigation component
 * Sectioned layout: System items + collapsible profile groups
 */

import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  Drawer,
  List,
  ListItem,
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
  Monitor,
  Plus,
  Server,
} from 'lucide-react';
import { useSnapshot } from 'valtio';
import { tokens } from '../../styles/tokens';
import { eventStore } from '../../state/events';
import { sidebarStore, toggleProfileExpanded } from '../../state/sidebar';
import { setScope } from '../../state/scope';
import { useStatus, useOpenClawDashboardUrl, useAlertsCount, useProfiles } from '../../api/hooks';
import { notify } from '../../stores/notifications';
import { OpenClawTokenDialog } from '../shared/OpenClawTokenDialog';
import { ProfileNavGroup } from './ProfileNavGroup';
import { SectionHeader, NavButton, ScrollableArea } from './Sidebar.styles';

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

const SYSTEM_ITEMS = [
  { path: '/canvas', label: 'Canvas', icon: <Monitor size={20} /> },
  { path: '/', label: 'Overview', icon: <LayoutDashboard size={20} /> },
  { path: '/skills', label: 'Skills', icon: <Zap size={20} /> },
  { path: '/secrets', label: 'Secrets', icon: <KeyRound size={20} /> },
  { path: '/activity', label: 'Activity', icon: <Activity size={20} /> },
  { path: '/integrations', label: 'Integrations', icon: <Plug size={20} /> },
  { path: '/mcps', label: 'MCP Servers', icon: <Server size={20} /> },
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
  const { expandedProfiles } = useSnapshot(sidebarStore);
  const { data: status } = useStatus();
  const { data: alertsCountData } = useAlertsCount();
  const alertCount = alertsCountData?.data?.count ?? 0;
  const { data: profilesResp } = useProfiles();
  const profiles = profilesResp?.data ?? [];
  const openClawDashboard = useOpenClawDashboardUrl();
  const [tokenDialog, setTokenDialog] = useState<{ url: string; token: string } | null>(null);

  const isProfileRoute = location.pathname.startsWith('/profiles/');

  const isSystemSelected = (path: string) => {
    if (isProfileRoute) return false;
    if (path === '/') return location.pathname === '/';
    return location.pathname.startsWith(path);
  };

  const handleNavigation = (path: string) => {
    if (path.startsWith('/profiles/')) {
      const profileId = path.split('/')[2];
      setScope(profileId);
    } else {
      setScope(null);
    }
    navigate(path);
    onClose();
  };

  const handleOpenClawClick = () => {
    openClawDashboard.mutate(undefined, {
      onSuccess: (data) => {
        if (data.data?.url && data.data?.token) {
          setTokenDialog({ url: data.data.url, token: data.data.token });
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
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Branding + controls */}
      <Box sx={{ px: 2, py: 2, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
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

      {/* SYSTEM section */}
      <SectionHeader>System</SectionHeader>
      <List sx={{ px: 1.5, pt: 0.5, pb: 0, flexShrink: 0 }}>
        {SYSTEM_ITEMS.map((item) => (
          <ListItem key={item.path} disablePadding sx={{ mb: 0.25 }}>
            <NavButton
              $selected={isSystemSelected(item.path)}
              onClick={() => handleNavigation(item.path)}
            >
              <ListItemIcon sx={{ minWidth: 30 }}>{item.icon}</ListItemIcon>
              <ListItemText
                primary={item.label}
                primaryTypographyProps={{ variant: 'subtitle1' }}
              />
              {item.path === '/' && alertCount > 0 && (
                <Chip
                  label={alertCount > 99 ? '99+' : alertCount}
                  size="small"
                  sx={{
                    height: 18,
                    minWidth: 18,
                    fontSize: '0.65rem',
                    fontWeight: 700,
                    bgcolor: 'error.main',
                    color: '#fff',
                    '& .MuiChip-label': { px: 0.5 },
                  }}
                />
              )}
            </NavButton>
          </ListItem>
        ))}
      </List>

      <Divider sx={{ mx: 1.5, my: 0.5, flexShrink: 0 }} />

      {/* OpenClaw link */}
      <List sx={{ px: 1.5, py: 0.5, flexShrink: 0 }}>
        <ListItem disablePadding>
          <NavButton
            onClick={handleOpenClawClick}
            disabled={openClawDashboard.isPending}
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
          </NavButton>
        </ListItem>
      </List>

      <Divider sx={{ mx: 1.5, my: 0.5, flexShrink: 0 }} />

      {/* PROFILES section header */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', pr: 1.5, flexShrink: 0 }}>
        <SectionHeader>Profiles</SectionHeader>
        <IconButton
          size="small"
          onClick={() => handleNavigation('/profiles')}
          sx={{ mt: 1 }}
        >
          <Plus size={14} />
        </IconButton>
      </Box>

      {/* Scrollable profile groups */}
      <ScrollableArea>
        {profiles.length === 0 ? (
          <Typography variant="caption" color="text.secondary" sx={{ px: 2, py: 1, display: 'block' }}>
            No profiles yet
          </Typography>
        ) : (
          <List disablePadding sx={{ pt: 0.5 }}>
            {profiles.map((profile) => (
              <ProfileNavGroup
                key={profile.id}
                profile={profile}
                expanded={!!expandedProfiles[profile.id]}
                onToggle={() => toggleProfileExpanded(profile.id)}
                onNavigate={handleNavigation}
                currentPath={location.pathname}
              />
            ))}
          </List>
        )}
      </ScrollableArea>

      {/* Footer */}
      <Divider sx={{ flexShrink: 0 }} />
      <Box sx={{ flexShrink: 0 }}>
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

      {/* OpenClaw token dialog */}
      <OpenClawTokenDialog
        open={tokenDialog !== null}
        url={tokenDialog?.url ?? ''}
        token={tokenDialog?.token ?? ''}
        onClose={() => setTokenDialog(null)}
      />
    </>
  );
}
