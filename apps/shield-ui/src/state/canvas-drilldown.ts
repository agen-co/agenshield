/**
 * Canvas drill-down state — tracks which app card is being inspected.
 *
 * When activeCardId is set, the canvas zooms into that card and shows
 * a DrilldownOverlay with MCP/skill hierarchy.
 */

import { proxy } from 'valtio';

export const drilldownStore = proxy({
  activeCardId: null as string | null,
});

export function openDrilldown(cardId: string) {
  drilldownStore.activeCardId = cardId;
}

export function closeDrilldown() {
  drilldownStore.activeCardId = null;
}
