/* eslint-disable @typescript-eslint/no-explicit-any */

// We need to mock 'node:fs' before the module loads,
// since debug-log captures appendFileSync/writeSync at import time.
const mockAppendFileSync = jest.fn();
const mockWriteSync = jest.fn();

jest.mock('node:fs', () => ({
  appendFileSync: mockAppendFileSync,
  writeSync: mockWriteSync,
}));

describe('debugLog', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
    mockAppendFileSync.mockReset();
    mockWriteSync.mockReset();
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  async function loadDebugLog() {
    const mod = await import('../debug-log');
    return mod.debugLog;
  }

  it('writes to primary log path when writable', async () => {
    process.env['HOME'] = '/home/test';
    // First call to appendFileSync is the probe (empty string)
    mockAppendFileSync.mockImplementation(() => {});

    const debugLog = await loadDebugLog();
    debugLog('hello world');

    // First call: probe write (empty string), second call: actual log line
    expect(mockAppendFileSync).toHaveBeenCalled();
    const lastCall = mockAppendFileSync.mock.calls[mockAppendFileSync.mock.calls.length - 1];
    expect(lastCall[0]).toContain('.agenshield/logs/interceptor.log');
    expect(lastCall[1]).toContain('hello world');
  });

  it('falls back to /tmp when primary path throws', async () => {
    process.env['HOME'] = '/home/test';
    // Probe call throws (primary path not writable)
    let callCount = 0;
    mockAppendFileSync.mockImplementation((path: string) => {
      callCount++;
      if (callCount === 1) {
        throw new Error('EACCES');
      }
    });

    const debugLog = await loadDebugLog();
    debugLog('fallback test');

    // After probe fails, subsequent writes go to /tmp path
    const lastCall = mockAppendFileSync.mock.calls[mockAppendFileSync.mock.calls.length - 1];
    expect(lastCall[0]).toBe('/tmp/agenshield-interceptor.log');
  });

  it('writes to stderr when AGENSHIELD_LOG_LEVEL=debug', async () => {
    process.env['AGENSHIELD_LOG_LEVEL'] = 'debug';
    mockAppendFileSync.mockImplementation(() => {});

    const debugLog = await loadDebugLog();
    debugLog('debug msg');

    expect(mockWriteSync).toHaveBeenCalledWith(2, expect.stringContaining('[AgenShield:debug] debug msg'));
  });

  it('does not write to stderr when log level is not debug', async () => {
    process.env['AGENSHIELD_LOG_LEVEL'] = 'warn';
    mockAppendFileSync.mockImplementation(() => {});

    const debugLog = await loadDebugLog();
    debugLog('warn msg');

    expect(mockWriteSync).not.toHaveBeenCalled();
  });

  it('includes timestamp and pid in log line', async () => {
    mockAppendFileSync.mockImplementation(() => {});

    const debugLog = await loadDebugLog();
    debugLog('test');

    const logCall = mockAppendFileSync.mock.calls[mockAppendFileSync.mock.calls.length - 1];
    expect(logCall[1]).toMatch(/\[\d{4}-\d{2}-\d{2}T/);
    expect(logCall[1]).toContain(`[pid:${process.pid}]`);
  });

  it('swallows errors from appendFileSync in debugLog', async () => {
    mockAppendFileSync
      .mockImplementationOnce(() => {}) // probe succeeds
      .mockImplementation(() => { throw new Error('disk full'); });

    const debugLog = await loadDebugLog();
    // Should not throw
    expect(() => debugLog('will fail')).not.toThrow();
  });

  it('swallows errors from writeSync', async () => {
    process.env['AGENSHIELD_LOG_LEVEL'] = 'debug';
    mockAppendFileSync.mockImplementation(() => {});
    mockWriteSync.mockImplementation(() => { throw new Error('EBADF'); });

    const debugLog = await loadDebugLog();
    expect(() => debugLog('test')).not.toThrow();
  });
});
