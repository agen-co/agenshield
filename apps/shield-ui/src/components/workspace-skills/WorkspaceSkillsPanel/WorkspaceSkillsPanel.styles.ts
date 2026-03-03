import { styled } from '@mui/material/styles';

export const Root = styled('div', {
  name: 'WorkspaceSkillsPanel',
  slot: 'Root',
})(({ theme }) => ({
  display: 'flex',
  flexDirection: 'column',
  gap: theme.spacing(3),
}));

export const WorkspaceGroup = styled('div', {
  name: 'WorkspaceSkillsPanel',
  slot: 'WorkspaceGroup',
})(({ theme }) => ({
  display: 'flex',
  flexDirection: 'column',
  gap: theme.spacing(1),
}));

export const SkillsList = styled('div', {
  name: 'WorkspaceSkillsPanel',
  slot: 'SkillsList',
})(({ theme }) => ({
  display: 'flex',
  flexDirection: 'column',
  gap: theme.spacing(1),
}));
