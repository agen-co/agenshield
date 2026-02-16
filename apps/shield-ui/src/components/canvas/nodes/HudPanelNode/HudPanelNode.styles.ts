import { styled } from '@mui/material/styles';

export const IndicatorRow = styled('div')({
  display: 'flex',
  alignItems: 'center',
  gap: 14,
  height: '100%',
  padding: '0 8px',
});

export const Indicator = styled('div')({
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  whiteSpace: 'nowrap',
});

export const IndicatorLabel = styled('span')(({ theme }) => ({
  fontSize: 9,
  fontWeight: 600,
  fontFamily: "'IBM Plex Mono', monospace",
  color: theme.palette.mode === 'dark' ? '#A0A090' : '#6A6A5A',
  letterSpacing: 0.3,
}));

export const IndicatorDot = styled('div')({
  width: 5,
  height: 5,
  borderRadius: '50%',
  flexShrink: 0,
});
