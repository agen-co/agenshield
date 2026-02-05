import { styled } from '@mui/material/styles';

export const SecretRow = styled('div', {
  name: 'SecretsList',
  slot: 'Row',
})(({ theme }) => ({
  display: 'flex',
  alignItems: 'center',
  gap: theme.spacing(2),
  padding: theme.spacing(1.5, 2),
  borderBottom: `1px solid ${theme.palette.divider}`,
  cursor: 'pointer',
  '&:last-child': {
    borderBottom: 'none',
  },
  '&:hover': {
    backgroundColor: theme.palette.action.hover,
  },
}));

export const SecretName = styled('div', {
  name: 'SecretsList',
  slot: 'Name',
})({
  flex: 1,
  minWidth: 0,
});

export const SecretValue = styled('code', {
  name: 'SecretsList',
  slot: 'Value',
})(({ theme }) => ({
  fontFamily: 'monospace',
  fontSize: 13,
  color: theme.palette.text.secondary,
  backgroundColor: theme.palette.action.hover,
  padding: '2px 8px',
  borderRadius: 4,
}));
