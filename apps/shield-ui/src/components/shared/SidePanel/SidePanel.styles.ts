import { styled } from '@mui/material/styles';
import { tokens } from '../../../styles/tokens';

export const Overlay = styled('div', {
  name: 'SidePanel',
  slot: 'Overlay',
  shouldForwardProp: (prop) => prop !== '$open',
})<{ $open: boolean }>(({ $open }) => ({
  position: 'fixed',
  inset: 0,
  zIndex: 1200,
  backgroundColor: 'rgba(0, 0, 0, 0.3)',
  opacity: $open ? 1 : 0,
  pointerEvents: $open ? 'auto' : 'none',
  transition: `opacity ${tokens.transition.duration} ${tokens.transition.easing}`,
}));

export const Panel = styled('div', {
  name: 'SidePanel',
  slot: 'Panel',
  shouldForwardProp: (prop) => !['$open', '$width'].includes(prop as string),
})<{ $open: boolean; $width: number }>(({ theme, $open, $width }) => ({
  position: 'fixed',
  top: 0,
  right: 0,
  bottom: 0,
  width: $width,
  maxWidth: '100vw',
  zIndex: 1201,
  backgroundColor: theme.palette.background.paper,
  boxShadow: theme.shadows[16],
  transform: $open ? 'translateX(0)' : `translateX(${$width}px)`,
  transition: `transform ${tokens.transition.duration} ${tokens.transition.easing}`,
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
}));

export const PanelHeader = styled('div', {
  name: 'SidePanel',
  slot: 'Header',
})(({ theme }) => ({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: theme.spacing(2, 3),
  borderBottom: `1px solid ${theme.palette.divider}`,
  flexShrink: 0,
}));

export const PanelContent = styled('div', {
  name: 'SidePanel',
  slot: 'Content',
})(({ theme }) => ({
  flex: 1,
  overflow: 'auto',
  padding: theme.spacing(3),
}));
