import { useLocation } from 'react-router-dom';
import { Box } from '@mui/material';
import { slideIn } from '../../styles/animations';

export function PageTransition({ children }: { children: React.ReactNode }) {
  const { pathname } = useLocation();

  return (
    <Box
      key={pathname}
      sx={{ animation: `${slideIn} 0.3s ease-out` }}
    >
      {children}
    </Box>
  );
}
