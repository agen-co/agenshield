import { styled } from '@mui/material/styles';
import { activitySlideIn, liveDot } from '../../../../styles/canvas-animations';

export const PanelWrapper = styled('div')(({ theme }) => ({
  width: 310,
  maxHeight: 'calc(100vh - 120px)',
  borderRadius: 12,
  background: theme.palette.mode === 'dark' ? 'rgba(10, 10, 10, 0.85)' : 'rgba(255, 255, 255, 0.9)',
  border: `1px solid ${theme.palette.divider}`,
  backdropFilter: 'blur(8px)',
  fontFamily: "'Manrope', sans-serif",
  overflow: 'hidden',
  display: 'flex',
  flexDirection: 'column',
  cursor: 'default',
}));

export const PanelHeader = styled('div')(({ theme }) => ({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '12px 16px',
  borderBottom: `1px solid ${theme.palette.divider}`,
}));

export const PanelTitle = styled('div')(({ theme }) => ({
  fontSize: 13,
  fontWeight: 700,
  color: theme.palette.text.primary,
}));

export const LiveDot = styled('div')({
  width: 6,
  height: 6,
  borderRadius: '50%',
  backgroundColor: '#6CB685',
  animation: `${liveDot} 2s ease-in-out infinite`,
});

export const EventList = styled('div')({
  overflow: 'auto',
  flex: 1,
  maxHeight: 480,
});

export const EventRow = styled('div')(({ theme }) => ({
  display: 'flex',
  alignItems: 'flex-start',
  gap: 8,
  padding: '8px 16px',
  borderBottom: `1px solid ${theme.palette.divider}`,
  animation: `${activitySlideIn} 0.3s ease-out`,
  '&:last-child': {
    borderBottom: 'none',
  },
}));

export const EventIconWrap = styled('div', {
  shouldForwardProp: (prop) => prop !== '$color',
})<{ $color: string }>(() => ({
  flexShrink: 0,
  display: 'flex',
  alignItems: 'center',
  marginTop: 2,
}));

export const EventContent = styled('div')({
  flex: 1,
  minWidth: 0,
});

export const EventLabel = styled('div')(({ theme }) => ({
  fontSize: 12,
  fontWeight: 500,
  color: theme.palette.text.primary,
  lineHeight: 1.3,
}));

export const EventSummary = styled('div')(({ theme }) => ({
  fontSize: 11,
  color: theme.palette.text.secondary,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap' as const,
  marginTop: 1,
}));

export const EventTime = styled('div')(({ theme }) => ({
  fontSize: 10,
  color: theme.palette.text.secondary,
  flexShrink: 0,
  marginTop: 2,
}));
