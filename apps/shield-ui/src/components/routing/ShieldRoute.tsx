/**
 * ShieldRoute — mode-aware route wrapper
 *
 * Gates page access based on the current daemon mode (setup vs daemon).
 * Redirects to the appropriate fallback when a route is not available
 * in the current mode.
 */

import { Navigate } from 'react-router-dom';
import { useServerMode } from '../../api/hooks';

type RouteMode = 'setup' | 'daemon' | 'update' | 'any';

interface ShieldRouteProps {
  children: React.ReactNode;
  allowedModes: RouteMode[];
  fallback?: string;
}

export function ShieldRoute({ children, allowedModes, fallback }: ShieldRouteProps) {
  const serverMode = useServerMode();

  // Still loading — render nothing to avoid flash
  if (!serverMode) return null;

  if (!allowedModes.includes(serverMode) && !allowedModes.includes('any')) {
    const redirectTo = fallback ?? (serverMode === 'setup' ? '/canvas' : '/');
    return <Navigate to={redirectTo} replace />;
  }

  return <>{children}</>;
}
