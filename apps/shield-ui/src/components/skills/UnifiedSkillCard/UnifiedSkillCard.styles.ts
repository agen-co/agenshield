import { styled } from '@mui/material/styles';

export const CardRoot = styled('div', {
  name: 'UnifiedSkillCard',
  slot: 'Root',
  shouldForwardProp: (prop) => prop !== '$selected',
})<{ $selected: boolean }>(({ theme, $selected }) => ({
  display: 'flex',
  flexDirection: 'column',
  gap: theme.spacing(1),
  padding: theme.spacing(2),
  borderRadius: (theme.shape.borderRadius as number) * 2,
  border: `1px solid ${$selected ? theme.palette.primary.main : theme.palette.divider}`,
  backgroundColor: $selected ? `${theme.palette.primary.main}08` : theme.palette.background.paper,
  cursor: 'pointer',
  transition: 'border-color 150ms ease, background-color 150ms ease',
  '&:hover': {
    borderColor: $selected ? theme.palette.primary.main : theme.palette.action.hover,
  },
}));

export const SkillIcon = styled('div', {
  name: 'UnifiedSkillCard',
  slot: 'Icon',
  shouldForwardProp: (prop) => prop !== '$color',
})<{ $color: string }>(({ $color }) => ({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 32,
  height: 32,
  borderRadius: 8,
  backgroundColor: `${$color}14`,
  color: $color,
  flexShrink: 0,
}));

export const Row = styled('div', {
  name: 'UnifiedSkillCard',
  slot: 'Row',
})({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  overflow: 'hidden',
});
