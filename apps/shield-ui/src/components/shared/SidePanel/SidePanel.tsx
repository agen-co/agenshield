import { Typography, IconButton } from '@mui/material';
import { X } from 'lucide-react';
import { Overlay, Panel, PanelHeader, PanelContent } from './SidePanel.styles';
import { tokens } from '../../../styles/tokens';
import type { SidePanelProps } from './SidePanel.types';

export function SidePanel({ open, onClose, title, children, width = tokens.sidePanel.width }: SidePanelProps) {
  return (
    <>
      <Overlay $open={open} onClick={onClose} />
      <Panel $open={open} $width={width}>
        {title && (
          <PanelHeader>
            <Typography variant="h6" fontWeight={600}>
              {title}
            </Typography>
            <IconButton onClick={onClose} size="small">
              <X size={18} />
            </IconButton>
          </PanelHeader>
        )}
        <PanelContent>{children}</PanelContent>
      </Panel>
    </>
  );
}
