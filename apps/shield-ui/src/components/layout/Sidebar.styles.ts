/**
 * Sidebar styled components
 */

import { styled, Box, ListItemButton, List, Typography } from '@mui/material';

/** Overline label for nav sections ("SYSTEM", "PROFILES") */
export const SectionHeader = styled(Typography)(({ theme }) => ({
  fontSize: '0.625rem',
  fontWeight: 700,
  letterSpacing: '0.08em',
  textTransform: 'uppercase' as const,
  color: theme.palette.text.secondary,
  padding: theme.spacing(1.5, 2, 0.5, 2),
}));

/** Nav button with transient $selected prop */
export const NavButton = styled(ListItemButton, {
  shouldForwardProp: (prop) => !String(prop).startsWith('$'),
})<{ $selected?: boolean }>(({ theme, $selected }) => ({
  paddingLeft: theme.spacing(1),
  paddingRight: theme.spacing(1),
  paddingTop: theme.spacing(0.25),
  paddingBottom: theme.spacing(0.25),
  borderRadius: theme.shape.borderRadius,
  '&:hover': {
    backgroundColor: theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.06)' : theme.palette.grey[50],
  },
  ...($selected && {
    backgroundColor: theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.1)' : theme.palette.grey[100],
    color: theme.palette.mode === 'dark' ? theme.palette.grey[50] : theme.palette.grey[900],
    '& .MuiListItemIcon-root': { color: 'inherit' },
    '&:hover': {
      backgroundColor: theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.14)' : theme.palette.grey[200],
    },
  }),
}));

/** Clickable profile row header with chevron */
export const ProfileGroupHeader = styled(ListItemButton)(({ theme }) => ({
  paddingLeft: theme.spacing(1),
  paddingRight: theme.spacing(1),
  paddingTop: theme.spacing(0.375),
  paddingBottom: theme.spacing(0.375),
  borderRadius: theme.shape.borderRadius,
  '&:hover': {
    backgroundColor: theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.06)' : theme.palette.grey[50],
  },
}));

/** Indented sub-nav list for profile items */
export const ProfileSubNav = styled(List)(({ theme }) => ({
  paddingLeft: theme.spacing(2.5),
  paddingTop: 0,
  paddingBottom: theme.spacing(0.5),
}));

/** Scrollable area for the profiles list */
export const ScrollableArea = styled(Box)({
  flex: 1,
  overflowY: 'auto',
  minHeight: 0,
});
