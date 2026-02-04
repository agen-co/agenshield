/**
 * Main layout component with persistent sidebar
 */

import React, { useState } from 'react';
import { Box } from '@mui/material';
import { Header } from './Header';
import { Sidebar } from './Sidebar';
import { tokens } from '../../styles/tokens';

interface LayoutProps {
  children: React.ReactNode;
  darkMode: boolean;
  onToggleDarkMode: () => void;
}

export function Layout({ children, darkMode, onToggleDarkMode }: LayoutProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh' }}>
      <Header
        onMenuClick={() => setSidebarOpen(true)}
        darkMode={darkMode}
        onToggleDarkMode={onToggleDarkMode}
      />
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      <Box
        component="main"
        sx={{
          flexGrow: 1,
          bgcolor: 'background.default',
          minHeight: '100vh',
          width: { md: `calc(100% - ${tokens.sidebar.width}px)` },
          pt: `${tokens.toolbar.height}px`,
          px: { xs: 2, sm: 3, md: 3 },
          py: 3,
        }}
      >
        {children}
      </Box>
    </Box>
  );
}
