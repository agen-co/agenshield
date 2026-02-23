/**
 * Styled components for the TargetOverview page
 */

import { styled, Box, Card } from '@mui/material';

/** 2-column CSS grid: main content + sidebar info */
export const PageGrid = styled(Box)(({ theme }) => ({
  display: 'grid',
  gridTemplateColumns: '1fr 360px',
  gap: theme.spacing(2.5),
  padding: theme.spacing(2),
  [theme.breakpoints.down('lg')]: {
    gridTemplateColumns: '1fr',
  },
}));

/** App header card with logo + name + controls */
export const HeaderCard = styled(Card)(({ theme }) => ({
  display: 'flex',
  alignItems: 'center',
  gap: theme.spacing(2),
  padding: theme.spacing(2.5),
}));

/** Key-value info row */
export const InfoRow = styled(Box)(({ theme }) => ({
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  padding: theme.spacing(1, 0),
  '&:not(:last-child)': {
    borderBottom: `1px solid ${theme.palette.divider}`,
  },
}));

/** Stat row for ranked lists */
export const StatRow = styled(Box)(({ theme }) => ({
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  padding: theme.spacing(0.75, 1),
  borderRadius: theme.shape.borderRadius,
  '&:hover': {
    backgroundColor: theme.palette.mode === 'dark'
      ? 'rgba(255,255,255,0.04)'
      : theme.palette.grey[50],
  },
}));
