import { styled } from '@mui/material/styles';

export const CanvasContainer = styled('div')(({ theme }) => ({
  width: '100%',
  height: 'calc(100vh - 0px)',
  position: 'relative',
  overflow: 'hidden',
  background: theme.palette.background.default,
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
}));

/* ---- Fixed overlays (outside ReactFlow, don't move with pan/zoom) ---- */

export const LogoOverlay = styled('div')({
  position: 'absolute',
  top: 20,
  left: 20,
  zIndex: 10,
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  cursor: 'default',
  fontFamily: "'Manrope', sans-serif",
  pointerEvents: 'auto',
});

export const LogoText = styled('div')(({ theme }) => ({
  fontWeight: 700,
  fontSize: 16,
  color: theme.palette.text.primary,
  letterSpacing: 0.3,
}));

export const LogoStatusChip = styled('div', {
  shouldForwardProp: (prop) => prop !== '$running',
})<{ $running: boolean }>(({ $running }) => ({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  padding: '2px 8px',
  borderRadius: 10,
  fontSize: 10,
  fontWeight: 600,
  background: $running ? 'rgba(108, 182, 133, 0.15)' : 'rgba(225, 88, 62, 0.15)',
  color: $running ? '#6CB685' : '#E1583E',
}));

export const LogoSub = styled('div')(({ theme }) => ({
  fontSize: 10,
  color: theme.palette.text.secondary,
  fontFamily: "'IBM Plex Mono', monospace",
  marginTop: 2,
}));

export const HudOverlay = styled('div')({
  position: 'absolute',
  top: 20,
  right: 20,
  zIndex: 10,
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  pointerEvents: 'auto',
});

export const HudItem = styled('div')({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  position: 'relative',
  cursor: 'default',
  padding: 4,
});

export const HudStatusDot = styled('div')({
  position: 'absolute',
  top: 2,
  right: 2,
  width: 6,
  height: 6,
  borderRadius: '50%',
});

export const BottomBarOverlay = styled('div')({
  position: 'absolute',
  bottom: 0,
  left: 0,
  right: 352, // align to left edge of activity panel (12 + 340)
  height: 100,
  zIndex: 1,
  pointerEvents: 'none',
  display: 'flex',
  justifyContent: 'flex-end',
  alignItems: 'flex-end',
});
