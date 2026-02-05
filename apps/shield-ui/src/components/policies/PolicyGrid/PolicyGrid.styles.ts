import { styled } from '@mui/material/styles';

export const Root = styled('div', {
  name: 'PolicyGrid',
  slot: 'Root',
})(({ theme }) => ({
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
  gap: theme.spacing(2.5),
}));
