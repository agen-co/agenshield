import { styled } from '@mui/material/styles';

export const SectionRoot = styled('div')(({ theme }) => ({
  marginTop: theme.spacing(3),
}));

export const SectionHeader = styled('button')(({ theme }) => ({
  display: 'flex',
  alignItems: 'center',
  gap: theme.spacing(1),
  width: '100%',
  padding: `${theme.spacing(1.5)} ${theme.spacing(2)}`,
  borderRadius: (theme.shape.borderRadius as number) * 2,
  border: `1px solid ${theme.palette.warning.main}40`,
  backgroundColor: `${theme.palette.warning.main}0A`,
  cursor: 'pointer',
  transition: 'background-color 150ms ease',
  background: 'none',
  font: 'inherit',
  color: theme.palette.text.primary,
  '&:hover': {
    backgroundColor: `${theme.palette.warning.main}14`,
  },
}));

export const CountBadge = styled('span')(({ theme }) => ({
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  minWidth: 20,
  height: 20,
  padding: '0 6px',
  borderRadius: 10,
  backgroundColor: theme.palette.warning.main,
  color: '#fff',
  fontSize: '0.7rem',
  fontWeight: 700,
}));
