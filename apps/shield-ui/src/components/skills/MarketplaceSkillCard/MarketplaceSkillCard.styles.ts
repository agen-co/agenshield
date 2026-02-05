import { styled } from '@mui/material/styles';

export const Root = styled('div', {
  name: 'MarketplaceSkillCard',
  slot: 'Root',
})(({ theme }) => ({
  display: 'flex',
  alignItems: 'center',
  gap: theme.spacing(1.5),
  padding: theme.spacing(1.5, 2),
  borderRadius: theme.shape.borderRadius,
  cursor: 'pointer',
  border: '1px solid transparent',
  transition: 'all 150ms ease',
  '&:hover': {
    backgroundColor: theme.palette.action.hover,
  },
}));

export const SkillIcon = styled('div', {
  name: 'MarketplaceSkillCard',
  slot: 'Icon',
  shouldForwardProp: (prop) => prop !== '$color',
})<{ $color: string }>(({ $color }) => ({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 36,
  height: 36,
  borderRadius: 8,
  backgroundColor: `${$color}14`,
  color: $color,
  flexShrink: 0,
}));

export const Info = styled('div', {
  name: 'MarketplaceSkillCard',
  slot: 'Info',
})({
  flex: 1,
  minWidth: 0,
});
