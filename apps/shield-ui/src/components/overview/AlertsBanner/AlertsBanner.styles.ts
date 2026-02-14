/**
 * AlertsBanner styled components
 */

import { styled, Box, Card } from '@mui/material';

export const BannerCard = styled(Card, {
  shouldForwardProp: (prop) => !String(prop).startsWith('$'),
})<{ $borderColor: string }>(({ theme, $borderColor }) => ({
  borderLeft: `4px solid ${$borderColor}`,
  borderRadius: theme.shape.borderRadius * 2,
  overflow: 'hidden',
}));

export const BannerHeader = styled(Box)(({ theme }) => ({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: theme.spacing(1.5, 2),
  cursor: 'pointer',
  '&:hover': {
    backgroundColor: theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)',
  },
}));

export const AlertList = styled(Box)(({ theme }) => ({
  display: 'flex',
  flexDirection: 'column',
  gap: theme.spacing(0.5),
  padding: theme.spacing(0, 2, 1.5),
}));

export const AlertItem = styled(Box)(({ theme }) => ({
  display: 'flex',
  alignItems: 'flex-start',
  gap: theme.spacing(1.5),
  padding: theme.spacing(1, 1.5),
  borderRadius: theme.shape.borderRadius,
  backgroundColor: theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)',
}));

export const AlertContent = styled(Box)({
  flex: 1,
  minWidth: 0,
});

export const AlertActions = styled(Box)(({ theme }) => ({
  display: 'flex',
  alignItems: 'center',
  gap: theme.spacing(0.5),
  flexShrink: 0,
}));
