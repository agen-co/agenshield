/**
 * Shot registry — maps edge IDs to imperative fireShot callbacks.
 *
 * Used to trigger electric shot animations on specific wires
 * when SSE events arrive (event-driven mode).
 *
 * Includes a global concurrency limit to prevent DOM saturation
 * during high event throughput (e.g. preset installation).
 */

const registry = new Map<string, () => void>();

/** Global concurrency tracking */
let globalActiveCount = 0;
const MAX_GLOBAL_CONCURRENT = 30;

export function canFireShot(): boolean {
  return globalActiveCount < MAX_GLOBAL_CONCURRENT;
}

export function incrementGlobal(): void {
  globalActiveCount++;
}

export function decrementGlobal(): void {
  globalActiveCount = Math.max(0, globalActiveCount - 1);
}

export function registerShot(edgeId: string, fire: () => void): void {
  registry.set(edgeId, fire);
}

export function unregisterShot(edgeId: string): void {
  registry.delete(edgeId);
}

/** Fire shots on all edges whose ID contains the given target ID substring */
export function fireShotForTarget(targetId: string): void {
  if (!canFireShot()) return;
  for (const [edgeId, fire] of registry) {
    if (edgeId.includes(targetId)) {
      fire();
    }
  }
}

/** Fire shots on all edges whose ID contains the given component ID substring */
export function fireShotForComponent(componentId: string): void {
  if (!canFireShot()) return;
  for (const [edgeId, fire] of registry) {
    if (edgeId.includes(componentId)) {
      fire();
    }
  }
}
