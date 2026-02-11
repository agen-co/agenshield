import { EventBus } from '../event-bus';
import type { EventRegistry, EventType } from '../event-registry';

// Ensure augmentations are loaded
import '../core.events';
import '../security.events';
import '../api.events';
import '../skill.events';
import '../process.events';

describe('EventBus', () => {
  let bus: EventBus;

  beforeEach(() => {
    bus = new EventBus();
  });

  // ---- on + emit ----

  it('delivers typed payload to subscriber', () => {
    const received: unknown[] = [];
    bus.on('heartbeat', (payload) => {
      received.push(payload);
    });

    bus.emit('heartbeat', { ping: true, message: 'hello' });

    expect(received).toHaveLength(1);
    expect(received[0]).toEqual({ ping: true, message: 'hello' });
  });

  it('delivers EventMeta with ISO timestamp', () => {
    let metaTs = '';
    bus.on('heartbeat', (_payload, meta) => {
      metaTs = meta.timestamp;
    });

    bus.emit('heartbeat', { ping: true });

    expect(metaTs).toBeTruthy();
    expect(new Date(metaTs).toISOString()).toBe(metaTs);
  });

  it('supports multiple listeners on the same event type', () => {
    let count = 0;
    bus.on('heartbeat', () => { count++; });
    bus.on('heartbeat', () => { count++; });

    bus.emit('heartbeat', {});

    expect(count).toBe(2);
  });

  it('calls listeners in registration order', () => {
    const order: number[] = [];
    bus.on('heartbeat', () => { order.push(1); });
    bus.on('heartbeat', () => { order.push(2); });
    bus.on('heartbeat', () => { order.push(3); });

    bus.emit('heartbeat', {});

    expect(order).toEqual([1, 2, 3]);
  });

  it('does not throw when emitting with no listeners', () => {
    expect(() => bus.emit('heartbeat', {})).not.toThrow();
  });

  // ---- off ----

  it('removes a specific listener via off()', () => {
    let count = 0;
    const listener = () => { count++; };

    bus.on('heartbeat', listener);
    bus.emit('heartbeat', {});
    expect(count).toBe(1);

    bus.off('heartbeat', listener);
    bus.emit('heartbeat', {});
    expect(count).toBe(1); // not called again
  });

  // ---- unsubscribe function from on() ----

  it('returns unsubscribe function from on()', () => {
    let count = 0;
    const unsub = bus.on('heartbeat', () => { count++; });

    bus.emit('heartbeat', {});
    expect(count).toBe(1);

    unsub();
    bus.emit('heartbeat', {});
    expect(count).toBe(1);
  });

  // ---- once ----

  it('once() fires exactly once then auto-removes', () => {
    let count = 0;
    bus.once('heartbeat', () => { count++; });

    bus.emit('heartbeat', {});
    bus.emit('heartbeat', {});
    bus.emit('heartbeat', {});

    expect(count).toBe(1);
  });

  it('once() returns unsubscribe that works before first emit', () => {
    let count = 0;
    const unsub = bus.once('heartbeat', () => { count++; });

    unsub();
    bus.emit('heartbeat', {});

    expect(count).toBe(0);
  });

  // ---- onChannel ----

  it('onChannel receives all events with matching prefix', () => {
    const received: string[] = [];
    bus.onChannel('skills', (type) => {
      received.push(type);
    });

    bus.emit('skills:installed', { name: 'my-skill' });
    bus.emit('skills:analyzed', { name: 'my-skill', analysis: {} });
    bus.emit('heartbeat', {}); // should NOT match

    expect(received).toEqual(['skills:installed', 'skills:analyzed']);
  });

  it('onChannel returns unsubscribe function', () => {
    const received: string[] = [];
    const unsub = bus.onChannel('skills', (type) => {
      received.push(type);
    });

    bus.emit('skills:installed', { name: 'a' });
    unsub();
    bus.emit('skills:uninstalled', { name: 'a' });

    expect(received).toEqual(['skills:installed']);
  });

  it('onChannel receives typed payload', () => {
    let receivedPayload: unknown = null;
    bus.onChannel('security', (_type, payload) => {
      receivedPayload = payload;
    });

    bus.emit('security:status', {
      runningAsRoot: false,
      currentUser: 'test',
      sandboxUserExists: true,
      isIsolated: false,
      guardedShellInstalled: false,
      exposedSecrets: [],
      warnings: [],
      critical: [],
      recommendations: [],
      level: 'secure',
    });

    expect(receivedPayload).toEqual(expect.objectContaining({ currentUser: 'test' }));
  });

  // ---- onAny ----

  it('onAny receives all events', () => {
    const received: string[] = [];
    bus.onAny((type) => {
      received.push(type);
    });

    bus.emit('heartbeat', {});
    bus.emit('skills:installed', { name: 'x' });
    bus.emit('config:changed', {});

    expect(received).toEqual(['heartbeat', 'skills:installed', 'config:changed']);
  });

  it('onAny returns unsubscribe function', () => {
    const received: string[] = [];
    const unsub = bus.onAny((type) => { received.push(type); });

    bus.emit('heartbeat', {});
    unsub();
    bus.emit('heartbeat', {});

    expect(received).toEqual(['heartbeat']);
  });

  // ---- Dispatch order: exact -> channel -> any ----

  it('fires exact, then channel, then any listeners', () => {
    const order: string[] = [];

    bus.on('skills:installed', () => { order.push('exact'); });
    bus.onChannel('skills', () => { order.push('channel'); });
    bus.onAny(() => { order.push('any'); });

    bus.emit('skills:installed', { name: 'x' });

    expect(order).toEqual(['exact', 'channel', 'any']);
  });

  // ---- removeAllListeners ----

  it('removeAllListeners() clears everything', () => {
    bus.on('heartbeat', () => {});
    bus.onChannel('skills', () => {});
    bus.onAny(() => {});

    expect(bus.listenerCount()).toBeGreaterThan(0);

    bus.removeAllListeners();

    expect(bus.listenerCount()).toBe(0);
  });

  it('removeAllListeners(type) clears only that type', () => {
    bus.on('heartbeat', () => {});
    bus.on('heartbeat', () => {});
    bus.on('config:changed', () => {});

    expect(bus.listenerCount('heartbeat')).toBe(2);
    expect(bus.listenerCount('config:changed')).toBe(1);

    bus.removeAllListeners('heartbeat');

    expect(bus.listenerCount('heartbeat')).toBe(0);
    expect(bus.listenerCount('config:changed')).toBe(1);
  });

  // ---- listenerCount ----

  it('listenerCount returns correct per-type count', () => {
    bus.on('heartbeat', () => {});
    bus.on('heartbeat', () => {});
    bus.on('config:changed', () => {});

    expect(bus.listenerCount('heartbeat')).toBe(2);
    expect(bus.listenerCount('config:changed')).toBe(1);
  });

  it('listenerCount() returns total across types, channels, and any', () => {
    bus.on('heartbeat', () => {});
    bus.on('config:changed', () => {});
    bus.onChannel('skills', () => {});
    bus.onAny(() => {});

    expect(bus.listenerCount()).toBe(4);
  });

  it('listenerCount returns 0 for unregistered type', () => {
    expect(bus.listenerCount('heartbeat')).toBe(0);
  });

  // ---- maxListeners warning ----

  it('warns when listener count exceeds maxListeners', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const small = new EventBus({ maxListeners: 2 });

    small.on('heartbeat', () => {});
    small.on('heartbeat', () => {});
    expect(warnSpy).not.toHaveBeenCalled();

    small.on('heartbeat', () => {});
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('heartbeat'),
    );

    warnSpy.mockRestore();
  });

  // ---- Type safety (compile-time checks) ----

  it('type system enforces correct payloads', () => {
    // These should compile:
    bus.emit('heartbeat', { ping: true });
    bus.emit('security:warning', { message: 'test' });
    bus.emit('skills:installed', { name: 'my-skill' });

    // @ts-expect-error — wrong payload type for security:warning
    bus.emit('security:warning', { wrong: 'field' });

    // @ts-expect-error — missing required field 'name' for skills:installed
    bus.emit('skills:installed', {});

    // @ts-expect-error — non-existent event type
    bus.emit('nonexistent:event', {});
  });
});
