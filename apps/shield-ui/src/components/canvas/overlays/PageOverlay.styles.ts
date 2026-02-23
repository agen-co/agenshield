import { styled, keyframes } from '@mui/material/styles';

const overlayEnter = keyframes`
  0% {
    opacity: 0;
    transform: scale(0.6);
  }
  40% {
    opacity: 0;
    transform: scale(0.7);
  }
  100% {
    opacity: 1;
    transform: scale(1);
  }
`;

export const OverlayRoot = styled('div')({
  position: 'fixed',
  inset: 0,
  zIndex: 20,
  display: 'flex',
});

export const ContentPanel = styled('div')<{ $isDark: boolean; $skipAnimation?: boolean }>(({ $isDark, $skipAnimation }) => ({
  position: 'relative',
  width: '100%',
  height: '100%',
  display: 'flex',
  flexDirection: 'column',
  backgroundColor: $isDark ? '#0f1114' : '#f8f8f6',
  animation: $skipAnimation ? 'none' : `${overlayEnter} 600ms cubic-bezier(0.16, 1, 0.3, 1) both`,
  overflow: 'hidden',
}));

export const OverlayHeader = styled('div')<{ $isDark: boolean }>(({ $isDark }) => ({
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  padding: '16px 24px',
  borderBottom: `1px solid ${$isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)'}`,
  flexShrink: 0,
}));

export const ScrollArea = styled('div')({
  flex: 1,
  overflow: 'auto',
  padding: 24,
});

/** Full-height variant for Overview — no scroll, flex column */
export const FullHeightArea = styled('div')({
  flex: 1,
  overflow: 'hidden',
  display: 'flex',
  flexDirection: 'column',
  padding: 24,
});
