import { styled } from '@mui/material/styles';
import { Box } from '@mui/material';

export const GraphContainer = styled(Box)(({ theme }) => ({
  width: '100%',
  height: 500,
  border: `1px solid ${theme.palette.divider}`,
  borderRadius: theme.shape.borderRadius * 2,
  overflow: 'hidden',
  backgroundColor: theme.palette.background.default,
}));

export const EmptyGraphBox = styled(Box)(({ theme }) => ({
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  height: 300,
  gap: theme.spacing(2),
  color: theme.palette.text.secondary,
}));
