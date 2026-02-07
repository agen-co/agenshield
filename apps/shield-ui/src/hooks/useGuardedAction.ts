/**
 * Convenience hook for guarded (unlock-on-click) actions.
 *
 * Returns a function that either executes an action immediately (if authenticated)
 * or prompts for passcode unlock first (if in read-only mode).
 */

import { useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { useUnlockAction } from '../context/UnlockContext';

export function useGuardedAction() {
  const { isReadOnly } = useAuth();
  const { requestUnlock } = useUnlockAction();

  return useCallback(
    (action: () => void, opts: { description: string; actionLabel: string }) => {
      if (!isReadOnly) {
        action();
        return;
      }
      requestUnlock({ ...opts, onUnlocked: action });
    },
    [isReadOnly, requestUnlock],
  );
}
