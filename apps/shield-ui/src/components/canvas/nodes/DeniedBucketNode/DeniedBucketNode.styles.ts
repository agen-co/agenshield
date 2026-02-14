import { styled } from '@mui/material/styles';

export const BucketWrapper = styled('div')(({ theme }) => ({
  padding: '10px 16px',
  borderRadius: 10,
  border: `2px solid ${theme.palette.error.main}`,
  background:
    theme.palette.mode === 'dark'
      ? 'rgba(225, 88, 62, 0.06)'
      : theme.palette.background.paper,
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  fontFamily: "'Manrope', sans-serif",
  cursor: 'default',
  minWidth: 120,
  opacity: 0.85,
}));

export const BucketLabel = styled('div')(({ theme }) => ({
  fontWeight: 600,
  fontSize: 12,
  color: theme.palette.text.primary,
  lineHeight: 1.3,
}));

export const CountBadge = styled('div')({
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  minWidth: 20,
  height: 20,
  padding: '0 6px',
  borderRadius: 10,
  fontSize: 11,
  fontWeight: 700,
  fontFamily: "'IBM Plex Mono', monospace",
  background: 'rgba(225, 88, 62, 0.15)',
  color: '#E1583E',
});
