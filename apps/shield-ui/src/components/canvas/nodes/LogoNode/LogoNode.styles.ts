import { styled } from '@mui/material/styles';

export const LogoWrapper = styled('div')({
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  cursor: 'default',
  fontFamily: "'Manrope', sans-serif",
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
