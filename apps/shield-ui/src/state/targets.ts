/**
 * Valtio store for target lifecycle status (driven by SSE push).
 */

import { proxy } from 'valtio';
import type { TargetStatusInfo } from '@agenshield/ipc';

export const targetsStore = proxy({
  targets: [] as TargetStatusInfo[],
  loaded: false,
});

export function setTargets(targets: TargetStatusInfo[]): void {
  targetsStore.targets = targets;
  targetsStore.loaded = true;
}
