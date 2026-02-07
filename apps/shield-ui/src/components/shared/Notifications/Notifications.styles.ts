import { styled } from '@mui/material/styles';
import Box from '@mui/material/Box';
import { tokens } from '../../../styles/tokens';

export const Stack = styled(Box)(({ theme }) => ({
  position: 'fixed',
  bottom: theme.spacing(3),
  right: theme.spacing(3),
  zIndex: tokens.zIndex.navigation + 100, // above everything
  display: 'flex',
  flexDirection: 'column-reverse',
  gap: theme.spacing(1),
  maxWidth: 400,
  minWidth: 320,
  pointerEvents: 'none',
  '& > *': {
    pointerEvents: 'auto',
  },
}));

export const ToastCard = styled(Box)(({ theme }) => ({
  borderRadius: tokens.radius.md,
  padding: theme.spacing(1.5, 2),
  display: 'flex',
  alignItems: 'flex-start',
  gap: theme.spacing(1.5),
  boxShadow: theme.shadows[4],
  animation: 'slideUpFade 220ms cubic-bezier(0.4, 0, 0.2, 1)',
  '@keyframes slideUpFade': {
    from: { opacity: 0, transform: 'translateY(12px)' },
    to: { opacity: 1, transform: 'translateY(0)' },
  },
}));
