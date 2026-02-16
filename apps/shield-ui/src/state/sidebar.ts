/**
 * Sidebar UI state — expanded/collapsed profile sections
 *
 * Persisted to localStorage so expand state survives page reloads.
 */

import { proxy, subscribe } from 'valtio';

const STORAGE_KEY = 'agenshield_sidebar_expanded';

function loadExpanded(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return {};
}

export const sidebarStore = proxy<{
  expandedProfiles: Record<string, boolean>;
}>({
  expandedProfiles: loadExpanded(),
});

subscribe(sidebarStore, () => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(sidebarStore.expandedProfiles));
});

export function toggleProfileExpanded(id: string): void {
  sidebarStore.expandedProfiles[id] = !sidebarStore.expandedProfiles[id];
}

export function setProfileExpanded(id: string, expanded: boolean): void {
  sidebarStore.expandedProfiles[id] = expanded;
}
