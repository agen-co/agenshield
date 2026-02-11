/**
 * EventRegistry — Extensible event type map.
 *
 * This interface starts empty and is augmented by domain event files via
 * `declare module './event-registry'`. When a domain file is imported
 * (directly or through the barrel), its events are merged into the
 * registry automatically.
 *
 * External packages can augment via `declare module '@agenshield/ipc'`.
 */

// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface EventRegistry {}

// ---- Derived types (resolve against the merged interface) ----

export type EventType = keyof EventRegistry;
export type EventPayload<T extends EventType> = EventRegistry[T];

/**
 * Channel = the prefix before the first ':'
 * e.g. 'security' from 'security:status', 'skills' from 'skills:installed'
 */
export type ChannelName = EventType extends `${infer C}:${string}` ? C : never;

// ---- Runtime event type registration ----

const _registeredTypes = new Set<string>();

/**
 * Register event type strings at runtime (called by each domain `.events.ts` file).
 * This powers SSE subscription lists and other runtime enumeration.
 */
export function registerEventTypes(types: readonly string[]): void {
  for (const t of types) _registeredTypes.add(t);
}

/**
 * Get all registered event type strings.
 */
export function getRegisteredEventTypes(): string[] {
  return [..._registeredTypes];
}
