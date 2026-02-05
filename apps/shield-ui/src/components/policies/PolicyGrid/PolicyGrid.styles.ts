import { styled } from '@mui/material/styles';

export const Root = styled('div', {
  name: 'PolicyGrid',
  slot: 'Root',
  shouldForwardProp: (prop) => prop !== '$collapsed',
})<{ $collapsed: boolean }>(({ theme, $collapsed }) => ({
  display: 'grid',
  gridTemplateColumns: $collapsed ? '1fr' : 'repeat(auto-fill, minmax(300px, 1fr))',
  gap: theme.spacing(2.5),
}));
