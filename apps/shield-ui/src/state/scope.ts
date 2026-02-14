/**
 * Scope state — current profile scope for multi-tenancy
 *
 * Read by the API client to send scope headers with every request.
 * Changed via the ScopeSelector in the sidebar.
 * Persisted to sessionStorage so it survives page reloads (per-tab).
 */

import { proxy, subscribe } from 'valtio';

const STORAGE_KEY = 'agenshield_scope';

function loadPersistedScope(): { profileId: string | null } {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      // Support legacy format migration
      if ('targetId' in parsed && !('profileId' in parsed)) {
        return { profileId: parsed.targetId ?? null };
      }
      return { profileId: parsed.profileId ?? null };
    }
  } catch { /* ignore */ }
  return { profileId: null };
}

const initial = loadPersistedScope();

export const scopeStore = proxy<{
  profileId: string | null;
}>({
  profileId: initial.profileId,
});

subscribe(scopeStore, () => {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify({
    profileId: scopeStore.profileId,
  }));
});

export function setScope(profileId: string | null): void {
  scopeStore.profileId = profileId;
}

export function clearScope(): void {
  scopeStore.profileId = null;
}
