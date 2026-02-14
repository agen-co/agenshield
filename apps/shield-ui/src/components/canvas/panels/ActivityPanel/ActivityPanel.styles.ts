import { styled } from '@mui/material/styles';
import Tabs from '@mui/material/Tabs';
import { activitySlideIn, liveDot } from '../../../../styles/canvas-animations';

export const PanelContainer = styled('div')(({ theme }) => ({
  position: 'absolute',
  top: 56,
  right: 12,
  bottom: 112,
  width: 340,
  zIndex: 10,
  display: 'flex',
  flexDirection: 'column',
  backgroundColor: theme.palette.mode === 'dark'
    ? 'rgba(28, 28, 28, 0.92)'
    : 'rgba(255, 255, 255, 0.92)',
  backdropFilter: 'blur(16px)',
  WebkitBackdropFilter: 'blur(16px)',
  borderRadius: 12,
  border: `1px solid ${theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}`,
  fontFamily: "'Manrope', sans-serif",
  pointerEvents: 'auto',
  overflow: 'hidden',
}));

export const AlertsHeader = styled('div')(({ theme }) => ({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '8px 12px',
  borderBottom: `1px solid ${theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)'}`,
}));

export const AlertsTitle = styled('div')({
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  fontSize: 12,
  fontWeight: 700,
});

export const AlertCount = styled('span')({
  fontSize: 10,
  fontWeight: 600,
  color: '#E1583E',
});

export const AlertItem = styled('div')(({ theme }) => ({
  display: 'flex',
  alignItems: 'flex-start',
  gap: 8,
  padding: '6px 12px',
  borderBottom: `1px solid ${theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)'}`,
  animation: `${activitySlideIn} 0.3s ease-out`,
  cursor: 'pointer',
  transition: 'background-color 0.15s',
  '&:hover': {
    backgroundColor:
      theme.palette.mode === 'dark'
        ? 'rgba(255,255,255,0.04)'
        : 'rgba(0,0,0,0.03)',
  },
  '&:last-child': {
    borderBottom: 'none',
  },
}));

export const StyledTabs = styled(Tabs)(({ theme }) => ({
  minHeight: 32,
  borderBottom: `1px solid ${theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)'}`,
  '& .MuiTab-root': {
    minHeight: 32,
    fontSize: 11,
    fontWeight: 600,
    textTransform: 'none',
    fontFamily: "'Manrope', sans-serif",
    padding: '4px 12px',
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
  padding: '6px 12px',
  borderBottom: `1px solid ${theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)'}`,
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
  fontSize: 11,
  fontWeight: 500,
  color: theme.palette.text.primary,
  lineHeight: 1.3,
}));

export const EventSummary = styled('div')(({ theme }) => ({
  fontSize: 10,
  color: theme.palette.text.secondary,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap' as const,
  marginTop: 1,
}));

export const EventTime = styled('div')(({ theme }) => ({
  fontSize: 9,
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

export const EmptyState = styled('div')(({ theme }) => ({
  padding: '24px 12px',
  textAlign: 'center',
  fontSize: 11,
  color: theme.palette.text.secondary,
}));

export const SectionDivider = styled('div')({
  height: 8,
  flexShrink: 0,
});

export const AcknowledgedHeader = styled('div')(({ theme }) => ({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '6px 12px',
  borderBottom: `1px solid ${theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)'}`,
  borderTop: `1px solid ${theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)'}`,
  backgroundColor: theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.02)',
}));

export const AcknowledgedTitle = styled('div')(({ theme }) => ({
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  fontSize: 11,
  fontWeight: 600,
  color: theme.palette.text.secondary,
}));

export const AcknowledgedItem = styled('div')(({ theme }) => ({
  display: 'flex',
  alignItems: 'flex-start',
  gap: 8,
  padding: '5px 12px',
  borderBottom: `1px solid ${theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)'}`,
  opacity: 0.6,
  cursor: 'pointer',
  transition: 'opacity 0.15s, background-color 0.15s',
  '&:hover': {
    opacity: 0.85,
    backgroundColor:
      theme.palette.mode === 'dark'
        ? 'rgba(255,255,255,0.03)'
        : 'rgba(0,0,0,0.02)',
  },
  '&:last-child': {
    borderBottom: 'none',
  },
}));
