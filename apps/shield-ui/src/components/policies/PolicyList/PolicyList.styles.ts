import { styled } from '@mui/material/styles';

export const PolicyRow = styled('div', {
  name: 'PolicyList',
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

export const PolicyName = styled('div', {
  name: 'PolicyList',
  slot: 'Name',
})({
  flex: '0 0 200px',
  minWidth: 0,
});

export const PolicyMeta = styled('div', {
  name: 'PolicyList',
  slot: 'Meta',
})(({ theme }) => ({
  display: 'flex',
  gap: theme.spacing(0.5),
  alignItems: 'center',
  flex: '0 0 auto',
}));

export const PolicySecrets = styled('div', {
  name: 'PolicyList',
  slot: 'Secrets',
})(({ theme }) => ({
  display: 'flex',
  gap: theme.spacing(0.5),
  flexWrap: 'wrap',
  alignItems: 'center',
  flex: 1,
  minWidth: 0,
}));
