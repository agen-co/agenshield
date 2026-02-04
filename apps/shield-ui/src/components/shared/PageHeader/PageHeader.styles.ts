import { styled } from '@mui/material/styles';

export const Root = styled('div', {
  name: 'PageHeader',
  slot: 'Root',
})({
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'flex-start',
  marginBottom: 32,
});

export const TitleGroup = styled('div', {
  name: 'PageHeader',
  slot: 'TitleGroup',
})({
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
});
