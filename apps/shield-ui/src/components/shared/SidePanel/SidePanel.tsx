import { Typography, IconButton, Drawer, useMediaQuery, useTheme } from '@mui/material';
import { X } from 'lucide-react';
import { InlinePanel, PanelHeader, PanelContent } from './SidePanel.styles';
import { tokens } from '../../../styles/tokens';
import type { SidePanelProps } from './SidePanel.types';

export function SidePanel({ open, onClose, title, children, width = tokens.sidePanel.width }: SidePanelProps) {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));

  const header = title ? (
    <PanelHeader>
      <Typography variant="h6" fontWeight={600}>
        {title}
      </Typography>
      <IconButton onClick={onClose} size="small">
        <X size={18} />
      </IconButton>
    </PanelHeader>
  ) : null;

  // Mobile: use a temporary Drawer overlay
  if (isMobile) {
    return (
      <Drawer
        anchor="right"
        open={open}
        onClose={onClose}
        PaperProps={{ sx: { width, maxWidth: '100vw' } }}
      >
        {header}
        <PanelContent>{children}</PanelContent>
      </Drawer>
    );
  }

  // Desktop: inline panel within flex container
  return (
    <InlinePanel $open={open} $width={width}>
      {header}
      <PanelContent>{children}</PanelContent>
    </InlinePanel>
  );
}
