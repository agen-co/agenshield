import { styled } from '@mui/material/styles';
import { Box, Card } from '@mui/material';
import { slideIn } from '../../../styles/animations';

export const CardGrid = styled(Box)(({ theme }) => ({
  display: 'grid',
  gridTemplateColumns: 'repeat(2, 1fr)',
  gap: theme.spacing(2),
  [theme.breakpoints.down('sm')]: {
    gridTemplateColumns: '1fr',
  },
}));

export const TypeCard = styled(Card, {
  shouldForwardProp: (prop) => prop !== '$delay',
})<{ $delay?: number }>(({ theme, $delay = 0 }) => ({
  elevation: 0,
  boxShadow: 'none',
  border: `1px solid ${theme.palette.divider}`,
  borderRadius: theme.shape.borderRadius * 2,
  padding: theme.spacing(3),
  cursor: 'pointer',
  transition: 'border-color 0.15s ease, box-shadow 0.15s ease',
  animation: `${slideIn} 0.35s ease both`,
  animationDelay: `${$delay}ms`,
  '&:hover': {
    borderColor: theme.palette.text.secondary,
    boxShadow: theme.shadows[2],
  },
}));

export const CardHeader = styled(Box)({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
});

export const CardTitleGroup = styled(Box)({
  display: 'flex',
  alignItems: 'center',
  gap: 10,
});

export const StatsRow = styled(Box)({
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: 6,
});

export const SecondaryRow = styled(Box)(({ theme }) => ({
  display: 'flex',
  gap: theme.spacing(2),
  marginTop: theme.spacing(2),
}));

export const SecondaryCard = styled(Card, {
  shouldForwardProp: (prop) => prop !== '$delay',
})<{ $delay?: number }>(({ theme, $delay = 0 }) => ({
  elevation: 0,
  boxShadow: 'none',
  border: `1px solid ${theme.palette.divider}`,
  borderRadius: theme.shape.borderRadius * 2,
  padding: theme.spacing(2, 3),
  flex: 1,
  cursor: 'pointer',
  transition: 'border-color 0.15s ease, box-shadow 0.15s ease',
  animation: `${slideIn} 0.35s ease both`,
  animationDelay: `${$delay}ms`,
  '&:hover': {
    borderColor: theme.palette.text.secondary,
    boxShadow: theme.shadows[2],
  },
}));
