/**
 * Isomorphic EventBus — works in both Node.js and browser environments.
 *
 * Pure TypeScript, no platform-specific APIs (no `node:events`, no DOM).
 * Provides type-safe subscribe/emit via the {@link EventRegistry}.
 */

import type { EventRegistry, EventType, ChannelName } from './event-registry';

export interface EventMeta {
  timestamp: string; // ISO 8601
}

type Listener<T> = (payload: T, meta: EventMeta) => void;
type ChannelListener = (type: string, payload: unknown, meta: EventMeta) => void;
type AnyListener = (type: string, payload: unknown, meta: EventMeta) => void;

export interface EventBusOptions {
  /** Warn when a single event type exceeds this many listeners (default 100). */
  maxListeners?: number;
}

const DEFAULT_MAX_LISTENERS = 100;

export class EventBus {
  private _listeners = new Map<string, Set<Listener<unknown>>>();
  private _channelListeners = new Map<string, Set<ChannelListener>>();
  private _anyListeners = new Set<AnyListener>();
  private _maxListeners: number;

  constructor(options?: EventBusOptions) {
    this._maxListeners = options?.maxListeners ?? DEFAULT_MAX_LISTENERS;
  }

  /**
   * Subscribe to a specific event type. Returns an unsubscribe function.
   */
  on<T extends EventType>(type: T, listener: Listener<EventRegistry[T]>): () => void {
    let set = this._listeners.get(type);
    if (!set) {
      set = new Set();
      this._listeners.set(type, set);
    }
    set.add(listener as Listener<unknown>);

    if (set.size > this._maxListeners) {
      console.warn(
        `EventBus: event "${type}" has ${set.size} listeners (max ${this._maxListeners}). Possible memory leak.`,
      );
    }

    return () => {
      set!.delete(listener as Listener<unknown>);
    };
  }

  /**
   * Subscribe once — auto-removes after the first call. Returns an unsubscribe function.
   */
  once<T extends EventType>(type: T, listener: Listener<EventRegistry[T]>): () => void {
    const wrapper: Listener<EventRegistry[T]> = (payload, meta) => {
      unsub();
      listener(payload, meta);
    };
    const unsub = this.on(type, wrapper);
    return unsub;
  }

  /**
   * Subscribe to all events matching a channel prefix.
   * e.g. `onChannel('skills', cb)` fires for `skills:installed`, `skills:analyzed`, etc.
   */
  onChannel(channel: ChannelName, listener: ChannelListener): () => void {
    let set = this._channelListeners.get(channel);
    if (!set) {
      set = new Set();
      this._channelListeners.set(channel, set);
    }
    set.add(listener);

    return () => {
      set!.delete(listener);
    };
  }

  /**
   * Subscribe to ALL events.
   */
  onAny(listener: AnyListener): () => void {
    this._anyListeners.add(listener);

    return () => {
      this._anyListeners.delete(listener);
    };
  }

  /**
   * Emit a typed event. Fires: exact listeners -> channel listeners -> any listeners.
   */
  emit<T extends EventType>(type: T, payload: EventRegistry[T]): void {
    const meta: EventMeta = { timestamp: new Date().toISOString() };

    // 1. Exact listeners
    const exact = this._listeners.get(type);
    if (exact) {
      for (const listener of exact) {
        listener(payload, meta);
      }
    }

    // 2. Channel listeners
    const colonIdx = type.indexOf(':');
    if (colonIdx !== -1) {
      const channel = type.slice(0, colonIdx);
      const channelSet = this._channelListeners.get(channel);
      if (channelSet) {
        for (const listener of channelSet) {
          listener(type, payload, meta);
        }
      }
    }

    // 3. Any listeners
    for (const listener of this._anyListeners) {
      listener(type, payload, meta);
    }
  }

  /**
   * Remove a specific listener from a type.
   */
  off<T extends EventType>(type: T, listener: Listener<EventRegistry[T]>): void {
    const set = this._listeners.get(type);
    if (set) {
      set.delete(listener as Listener<unknown>);
    }
  }

  /**
   * Remove all listeners, or all listeners for a specific type.
   */
  removeAllListeners(type?: EventType): void {
    if (type) {
      this._listeners.delete(type);
    } else {
      this._listeners.clear();
      this._channelListeners.clear();
      this._anyListeners.clear();
    }
  }

  /**
   * Count listeners for a specific type, or total listeners if no type given.
   */
  listenerCount(type?: EventType): number {
    if (type) {
      return this._listeners.get(type)?.size ?? 0;
    }
    let total = 0;
    for (const set of this._listeners.values()) {
      total += set.size;
    }
    total += this._anyListeners.size;
    for (const set of this._channelListeners.values()) {
      total += set.size;
    }
    return total;
  }
}
