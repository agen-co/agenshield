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

export const ScopeTag = styled('span', {
  name: 'SecretsList',
  slot: 'ScopeTag',
})(({ theme }) => ({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  fontSize: 12,
  fontWeight: 500,
  padding: '2px 8px',
  borderRadius: 4,
  color: theme.palette.text.secondary,
  backgroundColor: theme.palette.action.selected,
}));

export const GroupHeader = styled('div', {
  name: 'SecretsList',
  slot: 'GroupHeader',
})(({ theme }) => ({
  padding: theme.spacing(1.5, 2, 0.5),
  fontSize: 11,
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  color: theme.palette.text.secondary,
}));
