/**
 * SystemPanel styled components
 */

import { styled } from '@mui/material/styles';

const shouldForwardProp = (...names: string[]) => (prop: string) => !names.includes(prop);

export const PANEL_WIDTH = 340;

export const PanelRoot = styled('div', {
  shouldForwardProp: shouldForwardProp('$open'),
})<{ $open: boolean }>(({ theme, $open }) => ({
  position: 'absolute',
  top: 12,
  left: 12,
  bottom: 12,
  width: PANEL_WIDTH,
  transform: $open ? 'translateX(0)' : `translateX(-${PANEL_WIDTH + 24}px)`,
  opacity: $open ? 1 : 0,
  overflow: 'hidden',
  zIndex: 10,
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  backgroundColor: theme.palette.mode === 'dark'
    ? 'rgba(28, 28, 28, 0.88)'
    : 'rgba(255, 255, 255, 0.88)',
  backdropFilter: 'blur(12px)',
  WebkitBackdropFilter: 'blur(12px)',
  borderRadius: 12,
  border: `1px solid ${theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)'}`,
  fontFamily: "'Manrope', sans-serif",
  pointerEvents: $open ? 'auto' : 'none',
  transition: 'transform 0.3s ease, opacity 0.25s ease',
  padding: '12px 14px',
  overflowY: 'auto',
  '&::-webkit-scrollbar': {
    width: 4,
  },
  '&::-webkit-scrollbar-thumb': {
    backgroundColor: theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.15)',
    borderRadius: 2,
  },
}));

export const SectionCard = styled('div')(({ theme }) => ({
  padding: '10px 12px',
  borderRadius: 8,
  border: `1px solid ${theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)'}`,
  backgroundColor: theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)',
}));

export const SectionTitle = styled('div')(({ theme }) => ({
  fontSize: 10,
  fontWeight: 700,
  textTransform: 'uppercase' as const,
  letterSpacing: 0.8,
  color: theme.palette.text.secondary,
  marginBottom: 8,
}));

export const MetricRow = styled('div')({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  fontSize: 12,
  lineHeight: 1.6,
});

export const MetricLabel = styled('span')(({ theme }) => ({
  color: theme.palette.text.secondary,
  fontWeight: 400,
}));

export const MetricValue = styled('span')({
  fontWeight: 600,
  fontFamily: "'IBM Plex Mono', monospace",
  fontSize: 11,
});

export const StatusDot = styled('span', {
  shouldForwardProp: shouldForwardProp('$color'),
})<{ $color: string }>(({ $color }) => ({
  display: 'inline-block',
  width: 6,
  height: 6,
  borderRadius: '50%',
  backgroundColor: $color,
  marginRight: 6,
}));

export const TargetRow = styled('div')(({ theme }) => ({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '4px 0',
  fontSize: 12,
  '&:not(:last-child)': {
    borderBottom: `1px solid ${theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)'}`,
    paddingBottom: 6,
    marginBottom: 2,
  },
}));

export const TargetName = styled('span')({
  fontWeight: 600,
  flex: 1,
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap' as const,
});

export const TargetStatus = styled('span', {
  shouldForwardProp: shouldForwardProp('$variant'),
})<{ $variant: 'success' | 'warning' | 'info' }>(({ $variant }) => {
  const colors = {
    success: '#6CB685',
    warning: '#EEA45F',
    info: '#6BAEF2',
  };
  return {
    fontSize: 10,
    fontWeight: 600,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.3,
    color: colors[$variant],
  };
});

export const MiniProgress = styled('div')(({ theme }) => ({
  height: 3,
  borderRadius: 2,
  backgroundColor: theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
  overflow: 'hidden',
  marginTop: 6,
  marginBottom: 4,
}));

export const MiniProgressFill = styled('div', {
  shouldForwardProp: shouldForwardProp('$progress'),
})<{ $progress: number }>(({ $progress }) => ({
  height: '100%',
  width: `${$progress}%`,
  backgroundColor: '#6BAEF2',
  borderRadius: 2,
  transition: 'width 0.5s ease',
}));

export const ViewDetailsButton = styled('button')(({ theme }) => ({
  background: 'none',
  border: 'none',
  padding: 0,
  fontSize: 11,
  fontWeight: 500,
  color: theme.palette.mode === 'dark' ? '#6BAEF2' : '#3B82F6',
  cursor: 'pointer',
  fontFamily: "'Manrope', sans-serif",
  '&:hover': {
    textDecoration: 'underline',
  },
}));

export const ShieldButton = styled('button')(({ theme }) => ({
  width: '100%',
  padding: '7px 12px',
  borderRadius: 6,
  border: `1px solid ${theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.15)'}`,
  backgroundColor: 'transparent',
  color: theme.palette.text.primary,
  fontSize: 12,
  fontWeight: 600,
  fontFamily: "'Manrope', sans-serif",
  cursor: 'pointer',
  transition: 'background-color 0.2s',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 6,
  '&:hover': {
    backgroundColor: theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)',
  },
  '&:disabled': {
    opacity: 0.4,
    cursor: 'default',
  },
}));

/* Setup mode styled components */

export const SetupHeader = styled('div')(({ theme }) => ({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  paddingBottom: 8,
  borderBottom: `1px solid ${theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)'}`,
  marginBottom: 8,
}));

export const BackButton = styled('button')(({ theme }) => ({
  background: 'none',
  border: 'none',
  padding: 4,
  borderRadius: 4,
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: theme.palette.text.secondary,
  '&:hover': {
    backgroundColor: theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
  },
}));

export const SetupBody = styled('div')({
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  overflowY: 'auto',
  '&::-webkit-scrollbar': {
    width: 4,
  },
});

export const StepIndicator = styled('div')({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 6,
  marginBottom: 12,
});

export const StepDot = styled('span', {
  shouldForwardProp: shouldForwardProp('$state'),
})<{ $state: 'pending' | 'active' | 'completed' }>(({ $state }) => {
  const colors = {
    pending: 'rgba(128,128,128,0.3)',
    active: '#6BAEF2',
    completed: '#6CB685',
  };
  return {
    width: 8,
    height: 8,
    borderRadius: '50%',
    backgroundColor: colors[$state],
    transition: 'background-color 0.3s ease',
  };
});

export const StepLabel = styled('span', {
  shouldForwardProp: shouldForwardProp('$active'),
})<{ $active: boolean }>(({ theme, $active }) => ({
  fontSize: 10,
  fontWeight: $active ? 700 : 400,
  color: $active ? theme.palette.text.primary : theme.palette.text.secondary,
}));
