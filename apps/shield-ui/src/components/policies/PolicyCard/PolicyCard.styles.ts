import { styled } from '@mui/material/styles';

export const Root = styled('div', {
  name: 'PolicyCard',
  slot: 'Root',
  shouldForwardProp: (prop) => prop !== '$selected',
})<{ $selected: boolean }>(({ theme, $selected }) => ({
  padding: theme.spacing(3),
  borderRadius: (theme.shape.borderRadius as number) * 2,
  border: `1px solid ${$selected ? theme.palette.primary.main : theme.palette.divider}`,
  backgroundColor: $selected ? `${theme.palette.primary.main}06` : theme.palette.background.paper,
  cursor: 'pointer',
  transition: 'all 150ms ease',
  '&:hover': {
    borderColor: theme.palette.primary.light,
    boxShadow: theme.shadows[2],
  },
}));

export const Header = styled('div', {
  name: 'PolicyCard',
  slot: 'Header',
})({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  marginBottom: 8,
});

export const Footer = styled('div', {
  name: 'PolicyCard',
  slot: 'Footer',
})(({ theme }) => ({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  marginTop: theme.spacing(1.5),
  paddingTop: theme.spacing(1.5),
  borderTop: `1px solid ${theme.palette.divider}`,
}));
