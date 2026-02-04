import { styled } from '@mui/material/styles';
import { fadeIn } from '../../../styles/animations';

export const Root = styled('div', {
  name: 'ActivityFeed',
  slot: 'Root',
})({
  display: 'flex',
  flexDirection: 'column',
});

export const EventItem = styled('div', {
  name: 'ActivityFeed',
  slot: 'EventItem',
})(({ theme }) => ({
  display: 'flex',
  alignItems: 'flex-start',
  gap: theme.spacing(1.5),
  padding: theme.spacing(1.5, 0),
  borderBottom: `1px solid ${theme.palette.divider}`,
  animation: `${fadeIn} 0.3s ease-out`,
  '&:last-child': {
    borderBottom: 'none',
  },
}));

export const EventIcon = styled('div', {
  name: 'ActivityFeed',
  slot: 'EventIcon',
  shouldForwardProp: (prop) => prop !== '$color',
})<{ $color: string }>(({ $color }) => ({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 28,
  height: 28,
  borderRadius: 6,
  backgroundColor: `${$color}14`,
  color: $color,
  flexShrink: 0,
  marginTop: 2,
}));

export const EventContent = styled('div', {
  name: 'ActivityFeed',
  slot: 'EventContent',
})({
  flex: 1,
  minWidth: 0,
});
