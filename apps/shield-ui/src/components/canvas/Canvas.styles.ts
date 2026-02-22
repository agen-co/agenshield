import { styled } from '@mui/material/styles';
import { pcb } from './styles/pcb-tokens';

export const ThemeToggleOverlay = styled('div')({
  position: 'absolute',
  top: 20,
  right: 20,
  zIndex: 10,
  pointerEvents: 'auto',
});

export const CanvasContainer = styled('div')(({ theme }) => ({
  width: '100%',
  height: 'calc(100vh - 0px)',
  position: 'relative',
  overflow: 'hidden',
  background: theme.palette.mode === 'dark' ? pcb.board.base : pcb.light.base,
  '& .react-flow__attribution': {
    display: 'none',
  },
  '& .react-flow__controls': {
    bottom: 16,
    left: 16,
  },
  '& .react-flow__minimap': {
    bottom: 16,
    right: 16,
  },
  '& .react-flow__handle': {
    width: 6,
    height: 6,
    borderRadius: '50%',
    border: '1px solid #888',
    backgroundColor: '#D4A04A',
    opacity: 0.6,
  },
  // Remove all focus outlines from canvas elements
  '& .react-flow__node:focus, & .react-flow__node:focus-visible': {
    outline: 'none',
  },
  '& .react-flow__edge:focus, & .react-flow__edge:focus-visible': {
    outline: 'none',
  },
  '& .react-flow__pane:focus, & .react-flow__pane:focus-visible': {
    outline: 'none',
  },
  '& *:focus': {
    outline: 'none',
  },
}));

/* ---- Fixed overlays (outside ReactFlow, don't move with pan/zoom) ---- */

export const LogoOverlay = styled('div')(({ theme }) => ({
  position: 'absolute',
  top: 20,
  left: 20,
  zIndex: 10,
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  cursor: 'default',
  fontFamily: "'IBM Plex Mono', monospace",
  pointerEvents: 'auto',
  color: theme.palette.mode === 'dark' ? pcb.trace.bright : pcb.light.silk,
}));

export const LogoText = styled('div')(({ theme }) => ({
  fontWeight: 700,
  fontSize: 16,
  color: theme.palette.mode === 'dark' ? pcb.silk.primary : pcb.light.silk,
  letterSpacing: 1,
  textTransform: 'uppercase' as const,
}));

export const LogoStatusChip = styled('div', {
  shouldForwardProp: (prop) => prop !== '$running',
})<{ $running: boolean }>(({ $running, theme }) => ({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  padding: '2px 8px',
  borderRadius: 10,
  fontSize: 10,
  fontWeight: 600,
  fontFamily: "'IBM Plex Mono', monospace",
  background: $running
    ? `${pcb.component.ledGreen}20`
    : `${pcb.component.ledRed}20`,
  color: $running
    ? (theme.palette.mode === 'dark' ? pcb.component.ledGreen : '#2E7D32')
    : (theme.palette.mode === 'dark' ? pcb.component.ledRed : '#C62828'),
}));

export const LogoSub = styled('div')(({ theme }) => ({
  fontSize: 10,
  color: theme.palette.mode === 'dark' ? pcb.silk.dim : '#6A6A5A',
  fontFamily: "'IBM Plex Mono', monospace",
  marginTop: 2,
}));

