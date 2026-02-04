/**
 * Authentication module
 *
 * Re-exports all auth functionality.
 */

export {
  hashPasscode,
  verifyPasscode,
  isPasscodeSet,
  getPasscodeData,
  setPasscode,
  checkPasscode,
  isProtectionEnabled,
  setProtectionEnabled,
  isLockedOut,
  recordFailedAttempt,
  clearFailedAttempts,
  isRunningAsRoot,
} from './passcode';

export {
  SessionManager,
  getSessionManager,
  resetSessionManager,
} from './session';

export {
  extractToken,
  isAuthenticated,
  requireAuth,
  decorateWithAuth,
  PUBLIC_ROUTES,
  PROTECTED_ROUTES,
  isProtectedRoute,
  createAuthHook,
} from './middleware';
