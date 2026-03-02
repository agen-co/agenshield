/**
 * Canvas drill-down state — tracks zoom phase and setup-mode card drilldown.
 *
 * Zoom phase state machine:
 *   idle → zooming-in → zoomed (overlay appears) → zooming-out (overlay gone) → idle
 *
 * Component drilldown is now route-driven (/<page>/<tab>).
 * Only setup-mode card drilldown (activeCardId) remains in valtio.
 */

import { proxy } from 'valtio';
import type { SystemComponentType } from '../components/canvas/Canvas.types';

/* ---- Initial page-load detection (one-shot per full refresh) ---- */

let isInitialPageLoad = true;

/** Returns `true` on the first call after a full page refresh, `false` thereafter. */
export function consumeInitialPageLoad(): boolean {
  if (isInitialPageLoad) {
    isInitialPageLoad = false;
    return true;
  }
  return false;
}

/* ---- Component → page route mapping ---- */

export const COMPONENT_ROUTE_MAP: Record<SystemComponentType, {
  pageId: 'skills' | 'secrets' | 'policies' | 'overview' | 'settings' | 'metrics';
  defaultTab?: string;
  title: string;
}> = {
  skills:         { pageId: 'skills', title: 'Skills' },
  secrets:        { pageId: 'secrets', title: 'Secrets' },
  'policy-graph': { pageId: 'policies', title: 'Policies' },
  monitoring:     { pageId: 'overview', title: 'Overview' },
  cpu:            { pageId: 'metrics', title: 'System Metrics' },
  command:        { pageId: 'policies', title: 'Policies' },
  network:        { pageId: 'metrics', title: 'System Metrics' },
  filesystem:     { pageId: 'metrics', title: 'System Metrics' },
  memory:         { pageId: 'metrics', title: 'System Metrics' },
};

/* ---- Reverse mapping: page → default zoom target component ---- */

export const PAGE_ZOOM_TARGETS: Record<string, string> = {
  skills: 'skills',
  secrets: 'secrets',
  policies: 'network',
  overview: 'monitoring',
  settings: 'agenshield',
  metrics: 'metrics-cluster',
  target: 'agenshield', // fallback — overridden per-target in Canvas.tsx
};

/* ---- Zoom phase state ---- */

export type ZoomPhase = 'idle' | 'zooming-in' | 'zoomed' | 'zooming-out';

export const drilldownStore = proxy({
  activeCardId: null as string | null,
  zoomPhase: 'idle' as ZoomPhase,
  skipEntryAnimation: false,
});

/* ---- Actions ---- */

/** Open drilldown for an app card (setup mode → card detail panel) */
export function openDrilldown(cardId: string) {
  drilldownStore.activeCardId = cardId;
  drilldownStore.zoomPhase = 'zooming-in';
}

/** Transition zoom phase (e.g. zooming-in → zoomed after animation completes) */
export function setZoomPhase(phase: ZoomPhase) {
  drilldownStore.zoomPhase = phase;
}

/** Set or clear the skip-entry-animation flag (used to suppress overlay animation on deep-link refresh) */
export function setSkipEntryAnimation(skip: boolean) {
  drilldownStore.skipEntryAnimation = skip;
}

/** Start closing: trigger zoom-out animation (overlay disappears immediately) */
export function closeDrilldown() {
  drilldownStore.zoomPhase = 'zooming-out';
}

/** Reset everything to idle (called after zoom-out animation completes) */
export function clearDrilldown() {
  drilldownStore.activeCardId = null;
  drilldownStore.zoomPhase = 'idle';
}
