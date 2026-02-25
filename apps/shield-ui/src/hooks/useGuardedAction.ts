/**
 * Convenience hook for guarded actions.
 *
 * With JWT auth, if the user is authenticated they have full access.
 * No more read-only / unlock-on-click gating — actions execute directly.
 */

import { useCallback } from 'react';

export function useGuardedAction() {
  return useCallback(
    (action: () => void, _opts?: { description: string; actionLabel: string }) => {
      action();
    },
    [],
  );
}
