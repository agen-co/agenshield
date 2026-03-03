/**
 * Role definitions and permission matrix
 *
 * Defines what each role can access in the system.
 */

import type { TokenRole } from './types';

/**
 * Permission levels in order of privilege
 */
export const ROLE_HIERARCHY: readonly TokenRole[] = ['broker', 'admin'] as const;

/**
 * Check if a role has at least the required privilege level
 */
export function hasMinimumRole(actual: TokenRole, required: TokenRole): boolean {
  const actualIdx = ROLE_HIERARCHY.indexOf(actual);
  const requiredIdx = ROLE_HIERARCHY.indexOf(required);
  return actualIdx >= requiredIdx;
}

/**
 * Routes that require no authentication
 */
export const PUBLIC_ROUTES = [
  '/api/health',
  '/api/status',
  '/api/auth/status',
  '/api/auth/sudo-login',
  '/api/auth/admin-token',
  '/api/workspace-paths',
] as const;

/**
 * Routes that require admin role (write operations)
 */
export const ADMIN_ONLY_ROUTES = [
  { method: 'PUT', path: '/api/config' },
  { method: 'POST', path: '/api/wrappers' },
  { method: 'PUT', path: '/api/wrappers' },
  { method: 'DELETE', path: '/api/wrappers' },
  { method: 'POST', path: '/api/agenco/tool/run' },
  { method: 'POST', path: '/api/agenco/integrations/connect' },
  { method: 'POST', path: '/api/secrets' },
  { method: 'PATCH', path: '/api/secrets' },
  { method: 'DELETE', path: '/api/secrets' },
  { method: 'POST', path: '/api/config/factory-reset' },
  { method: 'POST', path: '/api/skills/install' },
  // Marketplace mutations
  { method: 'POST', path: '/api/marketplace/install' },
  { method: 'POST', path: '/api/marketplace/download' },
  { method: 'POST', path: '/api/marketplace/analyze' },
  // Skill mutations (wildcard — matches /api/skills/{name}/install etc.)
  { method: 'POST', path: '/api/skills/*/install' },
  { method: 'POST', path: '/api/skills/*/approve' },
  { method: 'POST', path: '/api/skills/*/revoke' },
  { method: 'POST', path: '/api/skills/*/unblock' },
  { method: 'POST', path: '/api/skills/*/analyze' },
  { method: 'PUT', path: '/api/skills/*/toggle' },
  { method: 'DELETE', path: '/api/skills/*' },
  { method: 'POST', path: '/api/skills/upload' },
  { method: 'GET', path: '/api/openclaw/dashboard-url' },
  { method: 'GET', path: '/api/config/openclaw' },
  { method: 'GET', path: '/api/config/openclaw/diff' },
  { method: 'GET', path: '/api/config/policies/instructions' },
  { method: 'GET', path: '/api/logs/stream' },
  { method: 'POST', path: '/api/auth/refresh' },
] as const;

/**
 * Check if a route is public (no auth required)
 */
export function isPublicRoute(path: string): boolean {
  return PUBLIC_ROUTES.some((route) => path.startsWith(route));
}

/**
 * Check if a route requires admin role
 */
export function isAdminOnlyRoute(method: string, path: string): boolean {
  return ADMIN_ONLY_ROUTES.some((route) => {
    if (route.method !== method) return false;
    if (route.path.includes('*')) {
      const pattern = route.path.replace(/\*/g, '[^/]+');
      return new RegExp(`^${pattern}$`).test(path);
    }
    return path.startsWith(route.path);
  });
}
