/**
 * ShieldRoute — mode-aware route wrapper
 *
 * Daemon always runs in 'daemon' mode now. This wrapper renders children
 * if 'daemon' or 'any' is in allowedModes, otherwise redirects.
 */

import { Navigate } from 'react-router-dom';

type RouteMode = 'setup' | 'daemon' | 'update' | 'any';

interface ShieldRouteProps {
  children: React.ReactNode;
  allowedModes: RouteMode[];
  fallback?: string;
}

export function ShieldRoute({ children, allowedModes, fallback }: ShieldRouteProps) {
  if (!allowedModes.includes('daemon') && !allowedModes.includes('any')) {
    const redirectTo = fallback ?? '/';
    return <Navigate to={redirectTo} replace />;
  }

  return <>{children}</>;
}
