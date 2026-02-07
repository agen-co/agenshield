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
  gridTemplateColumns: '400px 1fr',
  gap: theme.spacing(3),
  alignItems: 'start',
  [theme.breakpoints.down('md')]: {
    gridTemplateColumns: '1fr',
  },
}));

export const MetadataColumn = styled('div', {
  name: 'SkillDetails',
  slot: 'MetadataColumn',
})(({ theme }) => ({
  display: 'flex',
  flexDirection: 'column',
  gap: theme.spacing(2),
  position: 'sticky',
  top: theme.spacing(2),
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

export const MetadataSection = styled('div', {
  name: 'SkillDetails',
  slot: 'MetadataSection',
})(({ theme }) => ({
  display: 'flex',
  flexDirection: 'column',
  gap: theme.spacing(1),
}));
