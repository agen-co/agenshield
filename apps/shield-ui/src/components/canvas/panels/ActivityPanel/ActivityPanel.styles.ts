import { styled } from '@mui/material/styles';
import Tabs from '@mui/material/Tabs';
import { activitySlideIn, liveDot } from '../../../../styles/canvas-animations';

export const PanelContainer = styled('div')(({ theme }) => ({
  position: 'absolute',
  top: 0,
  right: 0,
  bottom: 0,
  width: 340,
  zIndex: 10,
  display: 'flex',
  flexDirection: 'column',
  background:
    theme.palette.mode === 'dark'
      ? 'rgba(10, 10, 10, 0.88)'
      : 'rgba(255, 255, 255, 0.92)',
  borderLeft: `1px solid ${theme.palette.divider}`,
  backdropFilter: 'blur(12px)',
  fontFamily: "'Manrope', sans-serif",
  pointerEvents: 'auto',
}));

export const AlertsHeader = styled('div')(({ theme }) => ({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '10px 16px',
  borderBottom: `1px solid ${theme.palette.divider}`,
}));

export const AlertsTitle = styled('div')({
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  fontSize: 13,
  fontWeight: 700,
});

export const AlertCount = styled('span')({
  fontSize: 11,
  fontWeight: 600,
  color: '#E1583E',
});

export const AlertItem = styled('div')(({ theme }) => ({
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

export const StyledTabs = styled(Tabs)(({ theme }) => ({
  minHeight: 36,
  borderBottom: `1px solid ${theme.palette.divider}`,
  '& .MuiTab-root': {
    minHeight: 36,
    fontSize: 12,
    fontWeight: 600,
    textTransform: 'none',
    fontFamily: "'Manrope', sans-serif",
    padding: '6px 16px',
  },
}));

export const FeedContainer = styled('div')({
  flex: 1,
  overflow: 'auto',
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

export const EventIconWrap = styled('div')({
  flexShrink: 0,
  display: 'flex',
  alignItems: 'center',
  marginTop: 2,
});

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

export const LiveDot = styled('div')({
  width: 6,
  height: 6,
  borderRadius: '50%',
  backgroundColor: '#6CB685',
  animation: `${liveDot} 2s ease-in-out infinite`,
});

export const CategoryHeader = styled('div', {
  shouldForwardProp: (p) => p !== '$expanded',
})<{ $expanded: boolean }>(({ theme }) => ({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '8px 16px',
  cursor: 'pointer',
  userSelect: 'none',
  borderBottom: `1px solid ${theme.palette.divider}`,
  '&:hover': {
    background:
      theme.palette.mode === 'dark'
        ? 'rgba(255,255,255,0.03)'
        : 'rgba(0,0,0,0.02)',
  },
}));

export const CategoryTitle = styled('div')(({ theme }) => ({
  fontSize: 12,
  fontWeight: 600,
  color: theme.palette.text.primary,
  flex: 1,
}));

export const CategoryCount = styled('div')(({ theme }) => ({
  fontSize: 11,
  fontWeight: 600,
  color: theme.palette.text.secondary,
  fontFamily: "'IBM Plex Mono', monospace",
}));

export const EmptyState = styled('div')(({ theme }) => ({
  padding: '24px 16px',
  textAlign: 'center',
  fontSize: 12,
  color: theme.palette.text.secondary,
}));
