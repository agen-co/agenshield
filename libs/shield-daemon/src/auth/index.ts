/**
 * Authentication module
 *
 * Re-exports JWT-based auth functionality.
 */

export {
  isRunningAsRoot,
} from './passcode';

export {
  extractToken,
  isAuthenticated,
  getJwtPayload,
  requireAuth,
  decorateWithAuth,
  createAuthHook,
} from './middleware';

export { redactConfig, redactSecurityStatus } from './redact';
