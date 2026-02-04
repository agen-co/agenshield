import { styled } from '@mui/material/styles';

export const MetricRow = styled('div', {
  name: 'SecurityStatus',
  slot: 'MetricRow',
})(({ theme }) => ({
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  padding: theme.spacing(1.5, 0),
  borderBottom: `1px solid ${theme.palette.divider}`,
  '&:last-child': {
    borderBottom: 'none',
  },
}));
