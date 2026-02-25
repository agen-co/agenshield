import { styled } from '@mui/material/styles';
import type { PolicyTier } from '@agenshield/ipc';

interface TierContainerProps {
  $tier: PolicyTier;
}

export const TierContainer = styled('div', {
  name: 'PolicyTierSection',
  slot: 'Root',
  shouldForwardProp: (prop) => !String(prop).startsWith('$'),
})<TierContainerProps>(({ theme, $tier }) => ({
  borderRadius: theme.shape.borderRadius * 2,
  border: `1px solid ${
    $tier === 'managed'
      ? theme.palette.warning.main
      : theme.palette.divider
  }`,
  overflow: 'hidden',
  '& + &': {
    marginTop: theme.spacing(2),
  },
}));

export const TierHeader = styled('div', {
  name: 'PolicyTierSection',
  slot: 'Header',
  shouldForwardProp: (prop) => !String(prop).startsWith('$'),
})<TierContainerProps>(({ theme, $tier }) => ({
  display: 'flex',
  alignItems: 'center',
  gap: theme.spacing(1),
  padding: theme.spacing(1.5, 2),
  cursor: 'default',
  backgroundColor:
    $tier === 'managed'
      ? theme.palette.mode === 'dark'
        ? 'rgba(237, 168, 56, 0.08)'
        : 'rgba(237, 168, 56, 0.04)'
      : 'transparent',
  borderBottom: `1px solid ${theme.palette.divider}`,
}));

export const TierContent = styled('div', {
  name: 'PolicyTierSection',
  slot: 'Content',
})({
  // Content wrapper — no additional padding; child lists manage their own
});
