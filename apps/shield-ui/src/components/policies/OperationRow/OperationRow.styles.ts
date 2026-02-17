import { styled, Box, Typography } from '@mui/material';

export const RowContainer = styled(Box)(({ theme }) => ({
  display: 'flex',
  alignItems: 'center',
  gap: theme.spacing(1.5),
  padding: theme.spacing(1, 2),
  borderBottom: `1px solid ${theme.palette.divider}`,
  '&:last-child': {
    borderBottom: 'none',
  },
}));

export const SeqNumber = styled(Typography)(({ theme }) => ({
  minWidth: 24,
  textAlign: 'right',
  color: theme.palette.text.disabled,
  fontSize: '0.75rem',
  fontWeight: 500,
}));

export const TargetText = styled(Typography)(() => ({
  fontFamily: '"IBM Plex Mono", monospace',
  fontSize: '0.8125rem',
  flex: 1,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
}));

export const MetaText = styled(Typography)(({ theme }) => ({
  color: theme.palette.text.secondary,
  fontSize: '0.75rem',
}));
