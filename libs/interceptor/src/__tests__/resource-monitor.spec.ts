/* eslint-disable @typescript-eslint/no-explicit-any */

import { EventEmitter } from 'node:events';

jest.mock('pidusage', () => jest.fn());
jest.mock('../debug-log', () => ({ debugLog: jest.fn() }));

import pidusage from 'pidusage';
import { ResourceMonitor } from '../resource/resource-monitor';

const mockPidusage = pidusage as jest.MockedFunction<typeof pidusage>;

describe('ResourceMonitor', () => {
  let mockReporter: any;
  let monitor: ResourceMonitor;

  beforeEach(() => {
    jest.useFakeTimers();
    mockReporter = {
      report: jest.fn(),
      intercept: jest.fn(),
      allow: jest.fn(),
      deny: jest.fn(),
      error: jest.fn(),
    };
    monitor = new ResourceMonitor(mockReporter, 100); // short grace period for tests
  });

  afterEach(() => {
    monitor.stopAll();
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  function createMockChild(pid: number): EventEmitter & { pid: number; kill: jest.Mock } {
    const child = new EventEmitter() as any;
    child.pid = pid;
    child.kill = jest.fn();
    return child;
  }

  describe('track', () => {
    it('does nothing when child has no pid', () => {
      const child = new EventEmitter() as any;
      child.pid = undefined;
      child.kill = jest.fn();

      monitor.track(child, 'cmd', { memoryMb: { warn: 100, kill: 200 } });
      expect((monitor as any).processes.size).toBe(0);
    });

    it('sets up interval with custom sampleIntervalMs', () => {
      const child = createMockChild(100);
      monitor.track(child, 'cmd', {
        memoryMb: { warn: 100, kill: 200 },
        sampleIntervalMs: 1000,
      });

      expect((monitor as any).processes.has(100)).toBe(true);
    });

    it('auto-cleans up on process exit', () => {
      const child = createMockChild(200);
      monitor.track(child, 'cmd', { memoryMb: { warn: 100, kill: 200 } });
      expect((monitor as any).processes.has(200)).toBe(true);

      child.emit('exit', 0);
      expect((monitor as any).processes.has(200)).toBe(false);
    });

    it('auto-cleans up on process error', () => {
      const child = createMockChild(300);
      monitor.track(child, 'cmd', { memoryMb: { warn: 100, kill: 200 } });

      child.emit('error', new Error('crash'));
      expect((monitor as any).processes.has(300)).toBe(false);
    });
  });

  describe('untrack', () => {
    it('clears interval and removes from map', () => {
      const child = createMockChild(400);
      monitor.track(child, 'cmd', { memoryMb: { warn: 100, kill: 200 } });
      expect((monitor as any).processes.has(400)).toBe(true);

      monitor.untrack(400);
      expect((monitor as any).processes.has(400)).toBe(false);
    });

    it('is a no-op for unknown pid', () => {
      expect(() => monitor.untrack(99999)).not.toThrow();
    });
  });

  describe('stopAll', () => {
    it('clears all intervals and processes', () => {
      const child1 = createMockChild(500);
      const child2 = createMockChild(501);
      monitor.track(child1, 'cmd1', { memoryMb: { warn: 100, kill: 200 } });
      monitor.track(child2, 'cmd2', { memoryMb: { warn: 100, kill: 200 } });

      monitor.stopAll();
      expect((monitor as any).processes.size).toBe(0);
    });
  });

  describe('sample', () => {
    // Helper to invoke the private sample() method directly,
    // avoiding fake timer + async callback interaction issues
    async function invokeSample(m: ResourceMonitor, pid: number) {
      const monitored = (m as any).processes.get(pid);
      if (monitored) {
        await (m as any).sample(monitored);
      }
    }

    it('checks memory threshold', async () => {
      const child = createMockChild(600);
      monitor.track(child, 'cmd', {
        memoryMb: { warn: 100, kill: 500 },
      });

      mockPidusage.mockResolvedValueOnce({
        memory: 150 * 1024 * 1024, // 150 MB
        cpu: 10,
        ppid: 1,
        pid: 600,
        ctime: 0,
        elapsed: 0,
        timestamp: 0,
      } as any);

      await invokeSample(monitor, 600);

      expect(mockReporter.report).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'error',
          operation: 'resource_warning',
        })
      );
    });

    it('checks CPU threshold', async () => {
      const child = createMockChild(601);
      monitor.track(child, 'cmd', {
        cpuPercent: { warn: 50, kill: 95 },
      });

      mockPidusage.mockResolvedValueOnce({
        memory: 50 * 1024 * 1024,
        cpu: 60,
        ppid: 1,
        pid: 601,
        ctime: 0,
        elapsed: 0,
        timestamp: 0,
      } as any);

      await invokeSample(monitor, 601);

      expect(mockReporter.report).toHaveBeenCalledWith(
        expect.objectContaining({
          operation: 'resource_warning',
        })
      );
    });

    it('kills process when memory exceeds kill threshold', async () => {
      const child = createMockChild(602);
      monitor.track(child, 'cmd', {
        memoryMb: { warn: 100, kill: 200 },
      });

      mockPidusage.mockResolvedValueOnce({
        memory: 250 * 1024 * 1024, // 250 MB > 200 kill
        cpu: 10,
        ppid: 1,
        pid: 602,
        ctime: 0,
        elapsed: 0,
        timestamp: 0,
      } as any);

      await invokeSample(monitor, 602);

      expect(child.kill).toHaveBeenCalledWith('SIGTERM');
      expect(mockReporter.report).toHaveBeenCalledWith(
        expect.objectContaining({
          operation: 'resource_limit_enforced',
        })
      );
    });

    it('checks timeout threshold', async () => {
      const child = createMockChild(603);
      monitor.track(child, 'cmd', {
        timeoutMs: { warn: 1000, kill: 50000 },
      });

      mockPidusage.mockResolvedValueOnce({
        memory: 50 * 1024 * 1024,
        cpu: 10,
        ppid: 1,
        pid: 603,
        ctime: 0,
        elapsed: 0,
        timestamp: 0,
      } as any);

      // Advance time so elapsed > warn threshold
      jest.advanceTimersByTime(2000);
      await invokeSample(monitor, 603);

      expect(mockReporter.report).toHaveBeenCalledWith(
        expect.objectContaining({
          operation: 'resource_warning',
        })
      );
    });

    it('untracks on pidusage error', async () => {
      const child = createMockChild(604);
      monitor.track(child, 'cmd', {
        memoryMb: { warn: 100, kill: 200 },
      });

      mockPidusage.mockRejectedValueOnce(new Error('No such process'));

      await invokeSample(monitor, 604);

      expect((monitor as any).processes.has(604)).toBe(false);
    });

    it('skips if process was already untracked', async () => {
      const child = createMockChild(605);
      monitor.track(child, 'cmd', {
        memoryMb: { warn: 100, kill: 200 },
      });

      monitor.untrack(605);

      // sample() called on an untracked pid → early return
      const monitored = {
        pid: 605,
        child,
        command: 'cmd',
        limits: { memoryMb: { warn: 100, kill: 200 } },
        startedAt: Date.now(),
        warnedMemory: false,
        warnedCpu: false,
        warnedTimeout: false,
        intervalId: null,
      };
      await (monitor as any).sample(monitored);

      // pidusage should not have been called since process is not in the map
      expect(mockPidusage).not.toHaveBeenCalled();
    });

    it('warns only once per metric', async () => {
      const child = createMockChild(606);
      monitor.track(child, 'cmd', {
        memoryMb: { warn: 100, kill: 500 },
      });

      const stats = {
        memory: 150 * 1024 * 1024,
        cpu: 10,
        ppid: 1,
        pid: 606,
        ctime: 0,
        elapsed: 0,
        timestamp: 0,
      } as any;

      mockPidusage.mockResolvedValueOnce(stats);
      await invokeSample(monitor, 606);

      const warningCount = mockReporter.report.mock.calls.filter(
        (c: any) => c[0].operation === 'resource_warning'
      ).length;
      expect(warningCount).toBe(1);

      mockPidusage.mockResolvedValueOnce(stats);
      await invokeSample(monitor, 606);

      const warningCount2 = mockReporter.report.mock.calls.filter(
        (c: any) => c[0].operation === 'resource_warning'
      ).length;

      // Should not have reported another warning
      expect(warningCount2).toBe(warningCount);
    });
  });

  describe('killProcess', () => {
    async function invokeSample(m: ResourceMonitor, pid: number) {
      const monitored = (m as any).processes.get(pid);
      if (monitored) {
        await (m as any).sample(monitored);
      }
    }

    it('escalates to SIGKILL after grace period if still alive', async () => {
      const child = createMockChild(700);
      monitor.track(child, 'cmd', {
        memoryMb: { warn: 100, kill: 200 },
      });

      mockPidusage.mockResolvedValueOnce({
        memory: 300 * 1024 * 1024,
        cpu: 10,
        ppid: 1,
        pid: 700,
        ctime: 0,
        elapsed: 0,
        timestamp: 0,
      } as any);

      // Mock process.kill(pid, 0) to indicate process is still alive
      const origKill = process.kill;
      (process as any).kill = jest.fn();

      await invokeSample(monitor, 700);

      expect(child.kill).toHaveBeenCalledWith('SIGTERM');

      // Advance past grace period
      jest.advanceTimersByTime(101);

      expect(child.kill).toHaveBeenCalledWith('SIGKILL');

      (process as any).kill = origKill;
    });

    it('handles SIGTERM error (process already dead)', async () => {
      const child = createMockChild(701);
      child.kill.mockImplementation(() => { throw new Error('ESRCH'); });

      monitor.track(child, 'cmd', {
        memoryMb: { warn: 100, kill: 200 },
      });

      mockPidusage.mockResolvedValueOnce({
        memory: 300 * 1024 * 1024,
        cpu: 10,
        ppid: 1,
        pid: 701,
        ctime: 0,
        elapsed: 0,
        timestamp: 0,
      } as any);

      await invokeSample(monitor, 701);

      // Should not throw
      expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    });

    it('skips SIGKILL if process already exited', async () => {
      const child = createMockChild(702);
      monitor.track(child, 'cmd', {
        memoryMb: { warn: 100, kill: 200 },
      });

      mockPidusage.mockResolvedValueOnce({
        memory: 300 * 1024 * 1024,
        cpu: 10,
        ppid: 1,
        pid: 702,
        ctime: 0,
        elapsed: 0,
        timestamp: 0,
      } as any);

      // process.kill(pid, 0) throws → process is dead
      const origKill = process.kill;
      (process as any).kill = jest.fn().mockImplementation(() => {
        throw new Error('ESRCH');
      });

      await invokeSample(monitor, 702);

      jest.advanceTimersByTime(101);
      // SIGKILL should NOT be called since process is already dead
      expect(child.kill).not.toHaveBeenCalledWith('SIGKILL');

      (process as any).kill = origKill;
    });
  });

  describe('reportWarning', () => {
    it('reports warning with correct data', async () => {
      const child = createMockChild(800);
      monitor.track(child, 'test-cmd', {
        memoryMb: { warn: 100, kill: 500 },
      }, 'trace-123');

      mockPidusage.mockResolvedValueOnce({
        memory: 150 * 1024 * 1024,
        cpu: 10,
        ppid: 1,
        pid: 800,
        ctime: 0,
        elapsed: 0,
        timestamp: 0,
      } as any);

      const monitored = (monitor as any).processes.get(800);
      await (monitor as any).sample(monitored);

      expect(mockReporter.report).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'error',
          operation: 'resource_warning',
          target: 'test-cmd',
        })
      );

      const errorData = JSON.parse(mockReporter.report.mock.calls[0][0].error);
      expect(errorData.pid).toBe(800);
      expect(errorData.command).toBe('test-cmd');
      expect(errorData.traceId).toBe('trace-123');
      expect(errorData.metric).toBe('memory');
      expect(errorData.unit).toBe('mb');
    });
  });

  describe('reportLimitEnforced', () => {
    it('reports enforcement with correct data', async () => {
      const child = createMockChild(801);
      monitor.track(child, 'heavy-cmd', {
        memoryMb: { warn: 100, kill: 200 },
      }, 'trace-456');

      mockPidusage.mockResolvedValueOnce({
        memory: 250 * 1024 * 1024,
        cpu: 10,
        ppid: 1,
        pid: 801,
        ctime: 0,
        elapsed: 0,
        timestamp: 0,
      } as any);

      const monitored = (monitor as any).processes.get(801);
      await (monitor as any).sample(monitored);

      const enforcedCalls = mockReporter.report.mock.calls.filter(
        (c: any) => c[0].operation === 'resource_limit_enforced'
      );
      expect(enforcedCalls.length).toBeGreaterThanOrEqual(1);

      const errorData = JSON.parse(enforcedCalls[0][0].error);
      expect(errorData.resourceEvent).toBe('resource:limit_enforced');
      expect(errorData.signal).toBe('SIGTERM');
      expect(errorData.gracefulExit).toBe(true);
    });
  });
});
