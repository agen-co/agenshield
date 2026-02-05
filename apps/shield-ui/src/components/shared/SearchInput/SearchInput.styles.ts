import { styled } from '@mui/material/styles';

export const Root = styled('div', {
  name: 'SearchInput',
  slot: 'Root',
})(({ theme }) => ({
  position: 'relative',
  display: 'flex',
  alignItems: 'center',
  borderRadius: theme.shape.borderRadius,
  backgroundColor: theme.palette.action.hover,
  border: `1px solid ${theme.palette.divider}`,
  height: 40,
  transition: 'border-color 200ms, box-shadow 200ms',
  '&:focus-within': {
    borderColor: theme.palette.primary.main,
    boxShadow: `0 0 0 2px ${theme.palette.primary.main}20`,
  },
}));

export const IconWrapper = styled('div', {
  name: 'SearchInput',
  slot: 'Icon',
})(({ theme }) => ({
  display: 'flex',
  alignItems: 'center',
  padding: '0 0 0 12px',
  color: theme.palette.text.secondary,
}));

export const Input = styled('input', {
  name: 'SearchInput',
  slot: 'Input',
})(({ theme }) => ({
  flex: 1,
  border: 'none',
  outline: 'none',
  background: 'transparent',
  padding: '0 12px',
  height: '100%',
  fontSize: '0.875rem',
  color: theme.palette.text.primary,
  fontFamily: 'inherit',
  '&::placeholder': {
    color: theme.palette.text.secondary,
    opacity: 0.7,
  },
}));
