/**
 * SetupPanel styled components
 */

import { styled } from '@mui/material/styles';

/** Filter `$`-prefixed transient props from DOM */
const shouldForwardProp = (...names: string[]) => (prop: string) => !names.includes(prop);

export const PanelRoot = styled('div', {
  shouldForwardProp: shouldForwardProp('$open'),
})<{ $open: boolean }>(({ theme, $open }) => ({
  position: 'absolute',
  top: 12,
  left: 12,
  bottom: 12,
  width: $open ? 380 : 0,
  opacity: $open ? 1 : 0,
  overflow: 'hidden',
  zIndex: 10,
  display: 'flex',
  flexDirection: 'column',
  backgroundColor: theme.palette.mode === 'dark'
    ? 'rgba(28, 28, 28, 0.94)'
    : 'rgba(255, 255, 255, 0.94)',
  backdropFilter: 'blur(16px)',
  WebkitBackdropFilter: 'blur(16px)',
  borderRadius: 12,
  border: $open
    ? `1px solid ${theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}`
    : 'none',
  fontFamily: "'Manrope', sans-serif",
  pointerEvents: $open ? 'auto' : 'none',
  transition: 'width 0.3s ease, opacity 0.25s ease',
}));

export const PanelHeader = styled('div')(({ theme }) => ({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '14px 16px 10px',
  borderBottom: `1px solid ${theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)'}`,
  flexShrink: 0,
}));

export const PanelTitle = styled('div')({
  fontSize: 14,
  fontWeight: 700,
  lineHeight: 1.2,
});

export const PanelSubtitle = styled('div')(({ theme }) => ({
  fontSize: 11,
  color: theme.palette.text.secondary,
  marginTop: 2,
}));

export const PanelBody = styled('div')({
  flex: 1,
  overflow: 'auto',
  padding: '12px 16px',
});

export const PanelFooter = styled('div')(({ theme }) => ({
  padding: '10px 16px',
  borderTop: `1px solid ${theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)'}`,
  flexShrink: 0,
}));

export const StepIndicator = styled('div')(({ theme }) => ({
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  padding: '8px 16px',
  borderBottom: `1px solid ${theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)'}`,
  flexShrink: 0,
}));

export const StepDot = styled('div', {
  shouldForwardProp: shouldForwardProp('$active', '$completed'),
})<{ $active: boolean; $completed: boolean }>(({ theme, $active, $completed }) => ({
  width: 8,
  height: 8,
  borderRadius: '50%',
  backgroundColor: $completed
    ? '#6CB685'
    : $active
      ? theme.palette.mode === 'dark' ? '#C0C0C0' : '#333'
      : theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.15)',
  transition: 'background-color 0.3s ease',
}));

export const StepLabel = styled('span', {
  shouldForwardProp: shouldForwardProp('$active'),
})<{ $active: boolean }>(({ theme, $active }) => ({
  fontSize: 10,
  fontWeight: $active ? 600 : 400,
  color: $active ? theme.palette.text.primary : theme.palette.text.secondary,
  marginLeft: 2,
  marginRight: 8,
}));

export const TargetCard = styled('div', {
  shouldForwardProp: shouldForwardProp('$selected'),
})<{ $selected: boolean }>(({ theme, $selected }) => ({
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  padding: '10px 12px',
  borderRadius: 8,
  border: `1px solid ${$selected
    ? (theme.palette.mode === 'dark' ? '#C0C0C0' : '#333')
    : (theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)')
  }`,
  backgroundColor: $selected
    ? (theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)')
    : 'transparent',
  cursor: 'pointer',
  transition: 'border-color 0.2s, background-color 0.2s',
  '&:hover': {
    backgroundColor: theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)',
  },
  marginBottom: 8,
}));

export const TargetIcon = styled('div')(({ theme }) => ({
  width: 36,
  height: 36,
  borderRadius: 8,
  backgroundColor: theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexShrink: 0,
}));

export const TargetInfo = styled('div')({
  flex: 1,
  minWidth: 0,
});

export const TargetName = styled('div')({
  fontSize: 13,
  fontWeight: 600,
  lineHeight: 1.2,
});

export const TargetMeta = styled('div')(({ theme }) => ({
  fontSize: 10,
  color: theme.palette.text.secondary,
  marginTop: 2,
}));

export const ProgressBar = styled('div')(({ theme }) => ({
  height: 4,
  borderRadius: 2,
  backgroundColor: theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)',
  overflow: 'hidden',
  marginTop: 8,
  marginBottom: 4,
}));

export const ProgressFill = styled('div', {
  shouldForwardProp: shouldForwardProp('$progress'),
})<{ $progress: number }>(({ $progress }) => ({
  height: '100%',
  width: `${$progress}%`,
  backgroundColor: '#6CB685',
  borderRadius: 2,
  transition: 'width 0.5s ease',
}));

export const ProgressLabel = styled('div')(({ theme }) => ({
  fontSize: 11,
  color: theme.palette.text.secondary,
  marginTop: 4,
}));

export const SectionTitle = styled('div')({
  fontSize: 12,
  fontWeight: 700,
  marginBottom: 8,
  marginTop: 4,
});

export const EmptyText = styled('div')(({ theme }) => ({
  fontSize: 12,
  color: theme.palette.text.secondary,
  textAlign: 'center',
  padding: '24px 0',
}));

export const ActionButton = styled('button')(({ theme }) => ({
  width: '100%',
  padding: '8px 16px',
  borderRadius: 6,
  border: 'none',
  backgroundColor: theme.palette.mode === 'dark' ? '#EDEDED' : '#171717',
  color: theme.palette.mode === 'dark' ? '#171717' : '#EDEDED',
  fontSize: 12,
  fontWeight: 600,
  fontFamily: "'Manrope', sans-serif",
  cursor: 'pointer',
  transition: 'opacity 0.2s',
  '&:hover': {
    opacity: 0.85,
  },
  '&:disabled': {
    opacity: 0.4,
    cursor: 'default',
  },
}));

export const SecondaryButton = styled('button')(({ theme }) => ({
  width: '100%',
  padding: '8px 16px',
  borderRadius: 6,
  border: `1px solid ${theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.2)'}`,
  backgroundColor: 'transparent',
  color: theme.palette.text.primary,
  fontSize: 12,
  fontWeight: 500,
  fontFamily: "'Manrope', sans-serif",
  cursor: 'pointer',
  transition: 'background-color 0.2s',
  '&:hover': {
    backgroundColor: theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)',
  },
}));

export const ShieldedBadge = styled('span')({
  fontSize: 9,
  fontWeight: 600,
  color: '#6CB685',
  textTransform: 'uppercase',
  letterSpacing: 0.5,
});
