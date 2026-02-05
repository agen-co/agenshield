import { styled } from '@mui/material/styles';
import { slideIn } from '../../../styles/animations';

export const Root = styled('div', {
  name: 'StatsRow',
  slot: 'Root',
})(({ theme }) => ({
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
  gap: theme.spacing(2.5),
  '& > *': {
    animation: `${slideIn} 0.4s ease-out both`,
  },
  '& > *:nth-of-type(1)': { animationDelay: '0ms' },
  '& > *:nth-of-type(2)': { animationDelay: '50ms' },
  '& > *:nth-of-type(3)': { animationDelay: '100ms' },
  '& > *:nth-of-type(4)': { animationDelay: '150ms' },
  '& > *:nth-of-type(5)': { animationDelay: '200ms' },
  '& > *:nth-of-type(6)': { animationDelay: '250ms' },
}));
