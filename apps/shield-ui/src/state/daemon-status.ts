/**
 * Valtio proxy store for daemon status (pushed via SSE)
 */

import { proxy } from 'valtio';
import type { DaemonStatus } from '@agenshield/ipc';

export const daemonStatusStore = proxy({
  status: null as DaemonStatus | null,
});

export function setDaemonStatus(status: DaemonStatus) {
  daemonStatusStore.status = status;
}
