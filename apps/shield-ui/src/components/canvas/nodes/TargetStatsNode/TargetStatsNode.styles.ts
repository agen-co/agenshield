import { styled } from '@mui/material/styles';

export const StatsRow = styled('div')({
  display: 'flex',
  gap: 6,
});

export const StatChip = styled('div')(({ theme }) => ({
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  padding: '4px 8px',
  borderRadius: 6,
  fontSize: 11,
  fontWeight: 600,
  fontFamily: "'Manrope', sans-serif",
  background: theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.06)' : theme.palette.grey[50],
  border: `1px solid ${theme.palette.divider}`,
  color: theme.palette.text.secondary,
  cursor: 'default',
}));
