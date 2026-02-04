import { styled } from '@mui/material/styles';
import { alertPulse, fadeIn, slideIn } from '../../../styles/animations';

export const Root = styled('div', {
  name: 'ConnectionError',
  slot: 'Root',
})(({ theme }) => ({
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  minHeight: '60vh',
  textAlign: 'center',
  gap: theme.spacing(3),
  padding: theme.spacing(4),
  animation: `${fadeIn} 0.4s ease-out`,
}));

export const IconContainer = styled('div', {
  name: 'ConnectionError',
  slot: 'Icon',
})(({ theme }) => ({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 80,
  height: 80,
  borderRadius: 20,
  backgroundColor: `${theme.palette.error.main}12`,
  color: theme.palette.error.main,
  animation: `${slideIn} 0.6s ease-out`,
}));

export const PulseRing = styled('div', {
  name: 'ConnectionError',
  slot: 'PulseRing',
})(({ theme }) => ({
  position: 'relative',
  '&::after': {
    content: '""',
    position: 'absolute',
    inset: -8,
    borderRadius: 24,
    border: `2px solid ${theme.palette.error.main}30`,
    animation: `${alertPulse} 2s ease-in-out infinite`,
  },
}));
