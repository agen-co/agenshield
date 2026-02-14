import { styled } from '@mui/material/styles';

export const CloudWrapper = styled('div', {
  shouldForwardProp: (prop) => prop !== '$connected',
})<{ $connected: boolean }>(({ theme, $connected }) => ({
  padding: '12px 20px',
  borderRadius: 12,
  border: `2px ${$connected ? 'solid' : 'dashed'} ${$connected ? '#6BAEF2' : theme.palette.grey[500]}`,
  background: $connected
    ? theme.palette.mode === 'dark' ? 'rgba(107, 174, 242, 0.08)' : theme.palette.background.paper
    : 'transparent',
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  fontFamily: "'Manrope', sans-serif",
  cursor: 'default',
  opacity: $connected ? 1 : 0.6,
}));

export const CloudLabel = styled('div')(({ theme }) => ({
  fontWeight: 600,
  fontSize: 13,
  color: theme.palette.text.primary,
  lineHeight: 1.3,
}));

export const CloudBadge = styled('div', {
  shouldForwardProp: (prop) => prop !== '$connected',
})<{ $connected: boolean }>(({ $connected }) => ({
  fontSize: 10,
  fontWeight: 600,
  color: $connected ? '#6BAEF2' : '#808080',
  textTransform: 'uppercase' as const,
  letterSpacing: 0.5,
}));
