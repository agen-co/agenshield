/**
 * Reactive hook that returns true when any target is being shielded.
 * Used to reduce polling intervals during heavy shielding operations.
 */

import { useSnapshot } from 'valtio';
import { setupPanelStore } from '../state/setup-panel';

export function useIsShielding(): boolean {
  const snap = useSnapshot(setupPanelStore);
  return Object.values(snap.shieldProgress).some(
    (p) => p.status === 'in_progress' || p.status === 'pending',
  );
}
