/**
 * Persistent sidebar navigation component
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
} from '@mui/material';
import {
  LayoutDashboard,
  ShieldCheck,
  Zap,
  KeyRound,
  Settings,
} from 'lucide-react';
import { tokens } from '../../styles/tokens';

const DRAWER_WIDTH = tokens.sidebar.width;

interface SidebarProps {
  open: boolean;
  onClose: () => void;
}

const menuItems = [
  { path: '/', label: 'Overview', icon: <LayoutDashboard size={20} /> },
  { path: '/policies', label: 'Policies', icon: <ShieldCheck size={20} /> },
  { path: '/skills', label: 'Skills', icon: <Zap size={20} /> },
  { path: '/secrets', label: 'Secrets', icon: <KeyRound size={20} /> },
  { path: '/settings', label: 'Settings', icon: <Settings size={20} /> },
];

export function Sidebar({ open, onClose }: SidebarProps) {
  const location = useLocation();
  const navigate = useNavigate();

  const handleNavigation = (path: string) => {
    navigate(path);
    onClose();
  };

  const drawerContent = (
    <Box sx={{ overflow: 'auto', height: '100%', display: 'flex', flexDirection: 'column' }}>
      <Box sx={{ height: `${tokens.toolbar.height}px`, flexShrink: 0 }} />
      <List sx={{ px: 1, pt: 1 }}>
        {menuItems.map((item) => (
          <ListItem key={item.path} disablePadding sx={{ mb: 0.5 }}>
            <ListItemButton
              selected={location.pathname === item.path}
              onClick={() => handleNavigation(item.path)}
              sx={{
                '&.Mui-selected': {
                  bgcolor: 'primary.main',
                  color: 'primary.contrastText',
                  '&:hover': { bgcolor: 'primary.dark' },
                  '& .MuiListItemIcon-root': { color: 'inherit' },
                  '& .MuiListItemText-primary': { color: 'inherit' },
                },
              }}
            >
              <ListItemIcon sx={{ minWidth: 36 }}>{item.icon}</ListItemIcon>
              <ListItemText
                primary={item.label}
                primaryTypographyProps={{ variant: 'subtitle1' }}
              />
            </ListItemButton>
          </ListItem>
        ))}
      </List>

      <Box sx={{ flexGrow: 1 }} />

      <Divider />
      <Box sx={{ p: 2 }}>
        <Typography variant="caption" color="text.secondary">
          AgenShield v0.1.0
        </Typography>
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
    </>
  );
}
