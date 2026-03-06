/* eslint-disable @typescript-eslint/no-explicit-any */

import { EventReporter } from '../events/reporter';

describe('EventReporter', () => {
  let mockClient: { request: jest.Mock };
  let reporter: EventReporter;

  beforeEach(() => {
    jest.useFakeTimers();
    mockClient = { request: jest.fn().mockResolvedValue(undefined) };
    reporter = new EventReporter({
      client: mockClient as any,
      logLevel: 'error', // suppress console output
    });
  });

  afterEach(() => {
    reporter.stop();
    jest.useRealTimers();
  });

  describe('report()', () => {
    it('queues events', () => {
      reporter.report({
        type: 'intercept',
        operation: 'exec',
        target: 'ls',
        timestamp: new Date(),
      });

      expect((reporter as any).queue).toHaveLength(1);
    });

    it('drops oldest events when queue exceeds MAX_QUEUE_SIZE', () => {
      // Make flush a no-op to prevent auto-flush from clearing the queue
      const origFlush = reporter.flush.bind(reporter);
      reporter.flush = jest.fn();

      // Push 500 events directly to bypass auto-flush at 100
      for (let i = 0; i < 500; i++) {
        (reporter as any).queue.push({
          type: 'intercept', operation: 'exec', target: `bg-${i}`, timestamp: new Date(),
        });
      }

      // Now report one more — queue length becomes 501, triggering the splice on line 75
      reporter.report({
        type: 'intercept', operation: 'exec', target: 'overflow', timestamp: new Date(),
      });

      expect((reporter as any).queue.length).toBe(500);
      // First bg event should be dropped
      const targets = (reporter as any).queue.map((e: any) => e.target);
      expect(targets).not.toContain('bg-0');
      expect(targets).toContain('overflow');

      // Restore flush
      reporter.flush = origFlush;
    });

    it('auto-flushes at 100 queued events', () => {
      for (let i = 0; i < 100; i++) {
        reporter.report({
          type: 'allow',
          operation: 'exec',
          target: `cmd-${i}`,
          timestamp: new Date(),
        });
      }

      expect(mockClient.request).toHaveBeenCalledWith('events_batch', expect.any(Object));
    });
  });

  describe('sanitizeTarget', () => {
    it('passes through short targets unchanged', () => {
      reporter.report({
        type: 'allow',
        operation: 'exec',
        target: 'ls -la',
        timestamp: new Date(),
      });

      expect((reporter as any).queue[0].target).toBe('ls -la');
    });

    it('truncates long targets', () => {
      const longTarget = 'x'.repeat(600);
      reporter.report({
        type: 'allow',
        operation: 'exec',
        target: longTarget,
        timestamp: new Date(),
      });

      const target = (reporter as any).queue[0].target;
      expect(target.length).toBeLessThan(600);
      expect(target).toContain('... [truncated]');
    });

    it('handles heredoc detection', () => {
      const heredocCmd = 'cat ' + 'x'.repeat(490) + ' <<EOF\nline1\nline2\nEOF';
      reporter.report({
        type: 'allow',
        operation: 'exec',
        target: heredocCmd,
        timestamp: new Date(),
      });

      const target = (reporter as any).queue[0].target;
      expect(target).toContain('[content omitted]');
    });
  });

  describe('convenience methods', () => {
    it('intercept() creates intercept event', () => {
      reporter.intercept('http_request', 'https://example.com');
      const event = (reporter as any).queue[0];
      expect(event.type).toBe('intercept');
      expect(event.operation).toBe('http_request');
      expect(event.target).toBe('https://example.com');
    });

    it('allow() creates allow event', () => {
      reporter.allow('exec', 'ls', 'p1', 42);
      const event = (reporter as any).queue[0];
      expect(event.type).toBe('allow');
      expect(event.policyId).toBe('p1');
      expect(event.duration).toBe(42);
    });

    it('deny() creates deny event', () => {
      reporter.deny('exec', 'rm -rf /', 'p2', 'dangerous');
      const event = (reporter as any).queue[0];
      expect(event.type).toBe('deny');
      expect(event.policyId).toBe('p2');
      expect(event.error).toBe('dangerous');
    });

    it('error() creates error event', () => {
      reporter.error('http_request', 'url', 'timeout');
      const event = (reporter as any).queue[0];
      expect(event.type).toBe('error');
      expect(event.error).toBe('timeout');
    });
  });

  describe('flush()', () => {
    it('does nothing when queue is empty', async () => {
      await reporter.flush();
      expect(mockClient.request).not.toHaveBeenCalled();
    });

    it('sends events and resets failedFlushCount on success', async () => {
      reporter.report({ type: 'allow', operation: 'exec', target: 'ls', timestamp: new Date() });
      await reporter.flush();

      expect(mockClient.request).toHaveBeenCalledWith('events_batch', {
        events: expect.arrayContaining([expect.objectContaining({ target: 'ls' })]),
      });
      expect((reporter as any).failedFlushCount).toBe(0);
      expect((reporter as any).queue).toHaveLength(0);
    });

    it('re-queues events on failure (up to MAX_RETRIES)', async () => {
      mockClient.request.mockRejectedValueOnce(new Error('network'));
      reporter.report({ type: 'allow', operation: 'exec', target: 'ls', timestamp: new Date() });
      await reporter.flush();

      // Events should be re-queued
      expect((reporter as any).queue).toHaveLength(1);
      expect((reporter as any).failedFlushCount).toBe(1);
    });

    it('drops events after MAX_RETRIES failures', async () => {
      mockClient.request.mockRejectedValue(new Error('fail'));

      reporter.report({ type: 'allow', operation: 'exec', target: 'a', timestamp: new Date() });
      await reporter.flush(); // fail 1: re-queue
      await reporter.flush(); // fail 2: re-queue
      await reporter.flush(); // fail 3: drop

      expect((reporter as any).queue).toHaveLength(0);
    });

    it('trims re-queued events if queue exceeds MAX_QUEUE_SIZE during retry', async () => {
      // Fill queue to near max
      for (let i = 0; i < 499; i++) {
        (reporter as any).queue.push({
          type: 'intercept', operation: 'exec', target: `bg-${i}`, timestamp: new Date(),
        });
      }

      // Add 10 events and flush — they'll go into the splice buffer
      const events: any[] = [];
      for (let i = 0; i < 10; i++) {
        events.push({ type: 'allow', operation: 'exec', target: `flush-${i}`, timestamp: new Date() });
      }
      // Manually set up the retry scenario: splice the queue's events, fail, re-queue
      const savedQueue = (reporter as any).queue.splice(0);
      (reporter as any).queue.push(...events);

      mockClient.request.mockRejectedValueOnce(new Error('fail'));
      // Re-add the background events so the re-queue makes it overflow
      (reporter as any).queue.push(...savedQueue);

      await reporter.flush();

      // Queue should be trimmed to MAX_QUEUE_SIZE
      expect((reporter as any).queue.length).toBeLessThanOrEqual(500);
    });
  });

  describe('stop()', () => {
    it('clears interval and calls flush', () => {
      reporter.report({ type: 'allow', operation: 'exec', target: 'ls', timestamp: new Date() });
      reporter.stop();

      expect((reporter as any).flushInterval).toBeNull();
      // flush is async but stop calls it
      expect(mockClient.request).toHaveBeenCalled();
    });
  });

  describe('periodic flush', () => {
    it('flushes on 5s interval', () => {
      reporter.report({ type: 'allow', operation: 'exec', target: 'ls', timestamp: new Date() });

      jest.advanceTimersByTime(5000);

      expect(mockClient.request).toHaveBeenCalled();
    });
  });

  describe('log level filtering', () => {
    it('logs deny events at warn level', () => {
      const warnReporter = new EventReporter({
        client: mockClient as any,
        logLevel: 'warn',
      });

      const warnSpy = jest.spyOn(console, 'warn').mockImplementation();
      warnReporter.deny('exec', 'rm', undefined, 'blocked');

      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('[AgenShield]'));
      warnSpy.mockRestore();
      warnReporter.stop();
    });

    it('does not log debug events when logLevel is warn', () => {
      const warnReporter = new EventReporter({
        client: mockClient as any,
        logLevel: 'warn',
      });

      const debugSpy = jest.spyOn(console, 'debug').mockImplementation();
      warnReporter.intercept('exec', 'ls');

      expect(debugSpy).not.toHaveBeenCalled();
      debugSpy.mockRestore();
      warnReporter.stop();
    });

    it('logs error events', () => {
      const errorSpy = jest.spyOn(console, 'error').mockImplementation();
      reporter.error('exec', 'cmd', 'oops');

      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('[AgenShield]'));
      errorSpy.mockRestore();
    });

    it('logs events with policy and duration details', () => {
      const warnReporter = new EventReporter({
        client: mockClient as any,
        logLevel: 'debug',
      });

      const debugSpy = jest.spyOn(console, 'debug').mockImplementation();
      warnReporter.allow('exec', 'ls', 'p1', 42);

      const logMsg = debugSpy.mock.calls[0][0] as string;
      expect(logMsg).toContain('[policy:p1]');
      expect(logMsg).toContain('[42ms]');
      debugSpy.mockRestore();
      warnReporter.stop();
    });

    it('getLogLevel returns info for unknown event types', () => {
      // Directly test the private getLogLevel with a synthetic event type
      const level = (reporter as any).getLogLevel({ type: 'unknown_type' });
      expect(level).toBe('info');
    });
  });
});
