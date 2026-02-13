/**
 * Wrapper lifecycle events.
 */

import { registerEventTypes } from './event-registry';

declare module '@agenshield/ipc' {
  interface EventRegistry {
    'wrappers:installed': Record<string, unknown>;
    'wrappers:uninstalled': Record<string, unknown>;
    'wrappers:updated': Record<string, unknown>;
    'wrappers:custom_added': Record<string, unknown>;
    'wrappers:custom_removed': Record<string, unknown>;
    'wrappers:synced': Record<string, unknown>;
    'wrappers:regenerated': Record<string, unknown>;
  }
}

export const WRAPPER_EVENT_TYPES = [
  'wrappers:installed',
  'wrappers:uninstalled',
  'wrappers:updated',
  'wrappers:custom_added',
  'wrappers:custom_removed',
  'wrappers:synced',
  'wrappers:regenerated',
] as const;

registerEventTypes(WRAPPER_EVENT_TYPES);
