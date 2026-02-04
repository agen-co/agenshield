import { styled } from '@mui/material/styles';

export const Root = styled('div', {
  name: 'SkillsList',
  slot: 'Root',
})(({ theme }) => ({
  display: 'flex',
  flexDirection: 'column',
  gap: theme.spacing(0.5),
}));

export const GroupLabel = styled('div', {
  name: 'SkillsList',
  slot: 'GroupLabel',
})(({ theme }) => ({
  padding: theme.spacing(1.5, 2, 0.5),
  fontSize: 11,
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  color: theme.palette.text.secondary,
}));
