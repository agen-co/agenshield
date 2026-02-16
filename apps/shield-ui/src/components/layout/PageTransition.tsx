import { useLocation } from 'react-router-dom';
import { Box } from '@mui/material';
import { slideIn } from '../../styles/animations';

/**
 * Animates page transitions with a slide-in effect.
 * Uses the first path segment as key so sub-path changes
 * (e.g. /policies/commands → /policies/network) don't re-trigger.
 */
export function PageTransition({ children }: { children: React.ReactNode }) {
  const { pathname } = useLocation();
  const segments = pathname.split('/');
  const pageKey = segments[1] === 'profiles' && segments[2]
    ? `/profiles/${segments[2]}`
    : `/${segments[1] ?? ''}`;

  return (
    <Box
      key={pageKey}
      sx={{ animation: `${slideIn} 0.3s ease-out` }}
    >
      {children}
    </Box>
  );
}
