import { styled } from '@mui/material/styles';

export const IconBox = styled('div', {
  name: 'StatCard',
  slot: 'IconBox',
  shouldForwardProp: (prop) => prop !== '$color',
})<{ $color: string }>(({ $color }) => ({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 8,
  borderRadius: 8,
  backgroundColor: `${$color}15`,
  color: $color,
}));

export const InlineIconBox = styled('div', {
  name: 'StatCard',
  slot: 'InlineIconBox',
  shouldForwardProp: (prop) => prop !== '$color',
})<{ $color: string }>(({ $color }) => ({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 4,
  borderRadius: 6,
  backgroundColor: `${$color}15`,
  color: $color,
}));
