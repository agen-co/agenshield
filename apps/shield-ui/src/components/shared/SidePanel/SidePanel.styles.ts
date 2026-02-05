import { styled } from '@mui/material/styles';
import { tokens } from '../../../styles/tokens';

/**
 * Desktop inline panel - sits inside a flex container, animates width
 */
export const InlinePanel = styled('div', {
  name: 'SidePanel',
  slot: 'Inline',
  shouldForwardProp: (prop) => !['$open', '$width'].includes(prop as string),
})<{ $open: boolean; $width: number }>(({ theme, $open, $width }) => ({
  flexShrink: 0,
  width: $open ? $width : 0,
  opacity: $open ? 1 : 0,
  overflow: 'hidden',
  display: 'flex',
  flexDirection: 'column' as const,
  borderLeft: $open ? `1px solid ${theme.palette.divider}` : 'none',
  backgroundColor: theme.palette.background.paper,
  transition: `width ${tokens.transition.duration} ${tokens.transition.easing}, opacity ${tokens.transition.duration} ${tokens.transition.easing}`,
}));

export const PanelHeader = styled('div', {
  name: 'SidePanel',
  slot: 'Header',
})(({ theme }) => ({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: theme.spacing(2, 3),
  borderBottom: `1px solid ${theme.palette.divider}`,
  flexShrink: 0,
}));

export const PanelContent = styled('div', {
  name: 'SidePanel',
  slot: 'Content',
})(({ theme }) => ({
  flex: 1,
  overflow: 'auto',
  padding: theme.spacing(3),
}));
