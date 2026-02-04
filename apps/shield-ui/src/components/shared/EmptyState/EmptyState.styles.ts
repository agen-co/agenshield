import { styled } from '@mui/material/styles';

export const Root = styled('div', {
  name: 'EmptyState',
  slot: 'Root',
})(({ theme }) => ({
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  padding: theme.spacing(6),
  textAlign: 'center',
  gap: theme.spacing(2),
}));

export const IconContainer = styled('div', {
  name: 'EmptyState',
  slot: 'Icon',
})(({ theme }) => ({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 64,
  height: 64,
  borderRadius: 16,
  backgroundColor: theme.palette.action.hover,
  color: theme.palette.text.secondary,
}));
