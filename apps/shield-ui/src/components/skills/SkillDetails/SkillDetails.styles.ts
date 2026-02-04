import { styled } from '@mui/material/styles';

export const Root = styled('div', {
  name: 'SkillDetails',
  slot: 'Root',
})(({ theme }) => ({
  display: 'flex',
  flexDirection: 'column',
  height: '100%',
}));

export const Header = styled('div', {
  name: 'SkillDetails',
  slot: 'Header',
})(({ theme }) => ({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: theme.spacing(2, 0),
  borderBottom: `1px solid ${theme.palette.divider}`,
  marginBottom: theme.spacing(2),
}));

export const Actions = styled('div', {
  name: 'SkillDetails',
  slot: 'Actions',
})(({ theme }) => ({
  display: 'flex',
  gap: theme.spacing(1),
}));

export const MetaRow = styled('div', {
  name: 'SkillDetails',
  slot: 'MetaRow',
})(({ theme }) => ({
  display: 'flex',
  gap: theme.spacing(2),
  marginBottom: theme.spacing(2),
}));
