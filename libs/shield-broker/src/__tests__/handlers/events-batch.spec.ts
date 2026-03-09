import { handleEventsBatch } from '../../handlers/events-batch.js';
import { createHandlerContext, createMockDeps } from '../helpers.js';

jest.mock('../../daemon-forward.js', () => ({
  forwardPolicyToDaemon: jest.fn().mockResolvedValue(null),
  forwardEventsToDaemon: jest.fn(),
  forwardOpenUrlToDaemon: jest.fn(),
}));

describe('handleEventsBatch', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should log each event via auditLogger', async () => {
    const deps = createMockDeps();
    const events = [
      { id: 'e1', operation: 'exec', allowed: true, target: 'node server.js' },
      { id: 'e2', operation: 'file_read', allowed: false, target: '/etc/passwd' },
    ];
    await handleEventsBatch({ events }, createHandlerContext(), deps);
    expect(deps.auditLogger.log).toHaveBeenCalledTimes(2);
  });

  it('should construct correct AuditEntry with defaults', async () => {
    const deps = createMockDeps();
    const events = [{ id: 'e1', target: '/tmp/test' }];
    await handleEventsBatch({ events }, createHandlerContext(), deps);
    expect(deps.auditLogger.log).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'e1',
        operation: 'events_batch',
        allowed: true,
        target: '/tmp/test',
        result: 'success',
      })
    );
  });

  it('should set result to denied when allowed is false', async () => {
    const deps = createMockDeps();
    const events = [{ id: 'e1', allowed: false, target: 'test' }];
    await handleEventsBatch({ events }, createHandlerContext(), deps);
    expect(deps.auditLogger.log).toHaveBeenCalledWith(
      expect.objectContaining({
        allowed: false,
        result: 'denied',
      })
    );
  });

  it('should return received count', async () => {
    const result = await handleEventsBatch(
      { events: [{ id: '1' }, { id: '2' }, { id: '3' }] },
      createHandlerContext(),
      createMockDeps()
    );
    expect(result.success).toBe(true);
    expect(result.data!.received).toBe(3);
  });

  it('should handle empty events array', async () => {
    const result = await handleEventsBatch({ events: [] }, createHandlerContext(), createMockDeps());
    expect(result.success).toBe(true);
    expect(result.data!.received).toBe(0);
  });

  it('should handle undefined events', async () => {
    const result = await handleEventsBatch({}, createHandlerContext(), createMockDeps());
    expect(result.success).toBe(true);
    expect(result.data!.received).toBe(0);
  });

  it('should forward non-empty events to daemon', async () => {
    const { forwardEventsToDaemon } = require('../../daemon-forward.js');
    const deps = createMockDeps();
    deps.daemonUrl = 'http://localhost:5200';
    deps.brokerAuth = { token: 'tok', profileId: 'p1' };
    const events = [{ id: 'e1', operation: 'exec', allowed: true, target: 'test' }];

    await handleEventsBatch({ events }, createHandlerContext(), deps);

    // forwardEventsToDaemon is called via setImmediate, flush it
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(forwardEventsToDaemon).toHaveBeenCalledWith(
      events,
      'http://localhost:5200',
      { token: 'tok', profileId: 'p1' }
    );
  });
});
