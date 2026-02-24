/**
 * Valtio store for security status (driven by SSE push).
 */

import { proxy } from 'valtio';
import type { SecurityStatusPayload } from '@agenshield/ipc';

export const securityStore = proxy({
  status: null as SecurityStatusPayload | null,
  loaded: false,
});

export function setSecurityStatus(status: SecurityStatusPayload): void {
  securityStore.status = status;
  securityStore.loaded = true;
}
