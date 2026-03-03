import { styled } from '@mui/material/styles';

export const Root = styled('div', {
  name: 'WorkspaceSkillCard',
  slot: 'Root',
})(({ theme }) => ({
  padding: theme.spacing(2),
  borderRadius: (theme.shape.borderRadius as number) * 2,
  border: `1px solid ${theme.palette.divider}`,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: theme.spacing(2),
  transition: 'all 150ms ease',
  '&:hover': {
    borderColor: theme.palette.text.secondary,
  },
}));

export const Info = styled('div', {
  name: 'WorkspaceSkillCard',
  slot: 'Info',
})(() => ({
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  minWidth: 0,
  flex: 1,
}));

export const Actions = styled('div', {
  name: 'WorkspaceSkillCard',
  slot: 'Actions',
})(({ theme }) => ({
  display: 'flex',
  gap: theme.spacing(1),
  flexShrink: 0,
}));
