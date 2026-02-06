import { styled } from '@mui/material/styles';

export const Root = styled('div', {
  name: 'SkillDetails',
  slot: 'Root',
})({
  display: 'flex',
  flexDirection: 'column',
});

export const ContentGrid = styled('div', {
  name: 'SkillDetails',
  slot: 'ContentGrid',
})(({ theme }) => ({
  display: 'grid',
  gridTemplateColumns: '1fr 280px',
  gap: theme.spacing(3),
  alignItems: 'start',
  [theme.breakpoints.down('md')]: {
    gridTemplateColumns: '1fr',
  },
}));

export const ReadmeCard = styled('div', {
  name: 'SkillDetails',
  slot: 'ReadmeCard',
})(({ theme }) => ({
  border: `1px solid ${theme.palette.divider}`,
  borderRadius: (theme.shape.borderRadius as number) * 2,
  padding: theme.spacing(3),
  backgroundColor: theme.palette.background.paper,
  minWidth: 0,
  overflow: 'hidden',
}));

export const Sidebar = styled('div', {
  name: 'SkillDetails',
  slot: 'Sidebar',
})(({ theme }) => ({
  display: 'flex',
  flexDirection: 'column',
  gap: theme.spacing(3),
  position: 'sticky',
  top: theme.spacing(2),
}));

export const SidebarSection = styled('div', {
  name: 'SkillDetails',
  slot: 'SidebarSection',
})(({ theme }) => ({
  display: 'flex',
  flexDirection: 'column',
  gap: theme.spacing(1),
}));
