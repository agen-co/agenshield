/**
 * Main layout component - sidebar only (no top bar)
 */

import { useState } from 'react';
import { Box, IconButton } from '@mui/material';
import { Menu } from 'lucide-react';
import { Sidebar } from './Sidebar';
import { tokens } from '../../styles/tokens';

interface LayoutProps {
  children: React.ReactNode;
  darkMode: boolean;
  onToggleDarkMode: () => void;
  disconnected?: boolean;
  onReconnect?: () => void;
  reconnecting?: boolean;
}

export function Layout({ children, darkMode, onToggleDarkMode, disconnected, onReconnect, reconnecting }: LayoutProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh' }}>
      <Sidebar
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        darkMode={darkMode}
        onToggleDarkMode={onToggleDarkMode}
        onMenuClick={() => setSidebarOpen(true)}
        disconnected={disconnected}
        onReconnect={onReconnect}
        reconnecting={reconnecting}
      />

      <Box
        component="main"
        sx={{
          flexGrow: 1,
          bgcolor: 'background.default',
          minHeight: '100vh',
          width: { md: `calc(100% - ${tokens.sidebar.width}px)` },
          px: { xs: 2, sm: 3, md: 3 },
          py: 3,
        }}
      >
        {/* Mobile menu button */}
        <IconButton
          onClick={() => setSidebarOpen(true)}
          sx={{
            display: { md: 'none' },
            mb: 2,
          }}
        >
          <Menu size={20} />
        </IconButton>

        {children}
      </Box>
    </Box>
  );
}
