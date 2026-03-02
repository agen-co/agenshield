import { styled } from '@mui/material/styles';
import { Box } from '@mui/material';

export const SectionCard = styled(Box)(({ theme }) => ({
  border: `1px solid ${theme.palette.divider}`,
  borderRadius: theme.shape.borderRadius * 2,
  padding: theme.spacing(2, 3),
  cursor: 'pointer',
  transition: 'border-color 0.15s ease, background-color 0.15s ease',
  '&:hover': {
    borderColor: theme.palette.text.secondary,
    backgroundColor: theme.palette.action.hover,
  },
}));

export const SectionHeader = styled(Box)({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  marginBottom: 8,
});

export const SectionTitle = styled(Box)({
  display: 'flex',
  alignItems: 'center',
  gap: 10,
});

export const ChipRow = styled(Box)({
  display: 'flex',
  flexWrap: 'wrap',
  gap: 6,
  marginTop: 4,
});
