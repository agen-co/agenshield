import { styled, Box } from '@mui/material';

export const SummaryBar = styled(Box)(({ theme }) => ({
  display: 'flex',
  alignItems: 'center',
  gap: theme.spacing(1),
  padding: theme.spacing(1.5, 2),
  borderBottom: `1px solid ${theme.palette.divider}`,
  flexWrap: 'wrap',
}));

export const OutputBlock = styled('pre')(({ theme }) => ({
  fontFamily: '"IBM Plex Mono", monospace',
  fontSize: '0.75rem',
  lineHeight: 1.6,
  margin: 0,
  padding: theme.spacing(2),
  backgroundColor: theme.palette.mode === 'dark' ? theme.palette.grey[900] : theme.palette.grey[50],
  borderRadius: theme.shape.borderRadius,
  overflow: 'auto',
  maxHeight: 240,
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-all',
}));
