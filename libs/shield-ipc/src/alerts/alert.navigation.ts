/**
 * Alert navigation — Maps event types to UI route paths
 */

const CHANNEL_ROUTES: Record<string, string> = {
  skills: '/skills',
  exec: '/policies',
  interceptor: '/policies',
  security: '/settings',
};

/**
 * Resolve the navigation target route for a given event type.
 */
export function resolveNavigationTarget(eventType: string): string {
  const colonIdx = eventType.indexOf(':');
  if (colonIdx !== -1) {
    const channel = eventType.slice(0, colonIdx);
    const route = CHANNEL_ROUTES[channel];
    if (route) return route;
  }
  return '/';
}
