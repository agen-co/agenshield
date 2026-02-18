/**
 * Resource Monitor
 *
 * Tracks spawned child processes and enforces resource limits
 * (CPU, memory, wall-clock time) by sampling via pidusage.
 *
 * Sync methods (execSync, spawnSync) block the event loop so
 * setInterval timers never fire — those cannot be monitored.
 */

import type { ChildProcess } from 'node:child_process';
import pidusage from 'pidusage';
import type { ResourceLimits } from '@agenshield/ipc';
import type { EventReporter } from '../events/reporter.js';

const DEFAULT_SAMPLE_INTERVAL_MS = 3000;
const DEFAULT_SIGKILL_GRACE_MS = 5000;

type ResourceMetric = 'memory' | 'cpu' | 'timeout';
type ResourceUnit = 'mb' | 'percent' | 'ms';

interface MonitoredProcess {
  child: ChildProcess;
  pid: number;
  command: string;
  traceId?: string;
  limits: ResourceLimits;
  startedAt: number;
  warnedMemory: boolean;
  warnedCpu: boolean;
  warnedTimeout: boolean;
  intervalId: NodeJS.Timeout | null;
}

export class ResourceMonitor {
  private processes = new Map<number, MonitoredProcess>();
  private sigkillGraceMs: number;
  private eventReporter: EventReporter;

  constructor(eventReporter: EventReporter, sigkillGraceMs = DEFAULT_SIGKILL_GRACE_MS) {
    this.eventReporter = eventReporter;
    this.sigkillGraceMs = sigkillGraceMs;
  }

  /**
   * Start monitoring a child process against the given resource limits.
   */
  track(child: ChildProcess, command: string, limits: ResourceLimits, traceId?: string): void {
    if (!child.pid) return;

    const pid = child.pid;
    const sampleIntervalMs = limits.sampleIntervalMs ?? DEFAULT_SAMPLE_INTERVAL_MS;

    const monitored: MonitoredProcess = {
      child,
      pid,
      command,
      traceId,
      limits,
      startedAt: Date.now(),
      warnedMemory: false,
      warnedCpu: false,
      warnedTimeout: false,
      intervalId: null,
    };

    // Auto-untrack on process exit or error
    const cleanup = () => this.untrack(pid);
    child.once('exit', cleanup);
    child.once('error', cleanup);

    // Start sampling interval (unref so it doesn't keep Node alive)
    const intervalId = setInterval(() => this.sample(monitored), sampleIntervalMs);
    intervalId.unref();
    monitored.intervalId = intervalId;

    this.processes.set(pid, monitored);
  }

  /**
   * Stop monitoring a process.
   */
  untrack(pid: number): void {
    const monitored = this.processes.get(pid);
    if (!monitored) return;

    if (monitored.intervalId) {
      clearInterval(monitored.intervalId);
      monitored.intervalId = null;
    }
    this.processes.delete(pid);
  }

  /**
   * Stop monitoring all tracked processes.
   */
  stopAll(): void {
    for (const [pid, monitored] of this.processes) {
      if (monitored.intervalId) {
        clearInterval(monitored.intervalId);
      }
    }
    this.processes.clear();
  }

  /**
   * Sample CPU/memory for a monitored process and check thresholds.
   */
  private async sample(monitored: MonitoredProcess): Promise<void> {
    // Check if process is still tracked (may have been cleaned up)
    if (!this.processes.has(monitored.pid)) return;

    try {
      const stats = await pidusage(monitored.pid);
      const memoryMb = stats.memory / (1024 * 1024);
      const cpuPercent = stats.cpu;

      // Check memory
      if (monitored.limits.memoryMb) {
        this.checkThreshold(monitored, 'memory', memoryMb, monitored.limits.memoryMb, 'mb');
      }

      // Check CPU
      if (monitored.limits.cpuPercent) {
        this.checkThreshold(monitored, 'cpu', cpuPercent, monitored.limits.cpuPercent, 'percent');
      }
    } catch {
      // Process may have exited between check and sample — clean up
      this.untrack(monitored.pid);
      return;
    }

    // Check wall-clock timeout (independent of pidusage)
    if (monitored.limits.timeoutMs) {
      const elapsed = Date.now() - monitored.startedAt;
      this.checkThreshold(monitored, 'timeout', elapsed, monitored.limits.timeoutMs, 'ms');
    }
  }

  /**
   * Check a metric value against warn/kill thresholds.
   */
  private checkThreshold(
    monitored: MonitoredProcess,
    metric: ResourceMetric,
    value: number,
    threshold: { warn: number; kill: number },
    unit: ResourceUnit,
  ): void {
    // Kill threshold takes priority
    if (value >= threshold.kill) {
      this.reportLimitEnforced(monitored, metric, value, threshold.kill, unit, 'SIGTERM');
      this.killProcess(monitored);
      return;
    }

    // Warn threshold (only once per metric to avoid spam)
    const warnedKey = `warned${metric.charAt(0).toUpperCase() + metric.slice(1)}` as
      'warnedMemory' | 'warnedCpu' | 'warnedTimeout';
    if (value >= threshold.warn && !monitored[warnedKey]) {
      monitored[warnedKey] = true;
      this.reportWarning(monitored, metric, value, threshold.warn, unit);
    }
  }

  /**
   * Kill a process with SIGTERM → grace period → SIGKILL escalation.
   */
  private killProcess(monitored: MonitoredProcess): void {
    const { child, pid } = monitored;

    // Stop sampling immediately
    this.untrack(pid);

    try {
      child.kill('SIGTERM');
    } catch {
      // Process may already be dead
      return;
    }

    // Escalate to SIGKILL after grace period if still alive
    const killTimer = setTimeout(() => {
      try {
        // Check if process is still alive (throws if not)
        process.kill(pid, 0);
        // Still alive — force kill
        child.kill('SIGKILL');
      } catch {
        // Already dead — nothing to do
      }
    }, this.sigkillGraceMs);
    killTimer.unref();
  }

  /**
   * Report a resource warning via EventReporter.
   */
  private reportWarning(
    monitored: MonitoredProcess,
    metric: ResourceMetric,
    value: number,
    threshold: number,
    unit: ResourceUnit,
  ): void {
    const data = {
      resourceEvent: 'resource:warning',
      pid: monitored.pid,
      command: monitored.command,
      traceId: monitored.traceId,
      metric,
      currentValue: Math.round(value * 100) / 100,
      threshold,
      unit,
    };
    this.eventReporter.report({
      type: 'error',
      operation: 'resource_warning',
      target: monitored.command,
      timestamp: new Date(),
      error: JSON.stringify(data),
    });
  }

  /**
   * Report a resource limit enforcement via EventReporter.
   */
  private reportLimitEnforced(
    monitored: MonitoredProcess,
    metric: ResourceMetric,
    value: number,
    threshold: number,
    unit: ResourceUnit,
    signal: 'SIGTERM' | 'SIGKILL',
  ): void {
    const data = {
      resourceEvent: 'resource:limit_enforced',
      pid: monitored.pid,
      command: monitored.command,
      traceId: monitored.traceId,
      metric,
      currentValue: Math.round(value * 100) / 100,
      threshold,
      unit,
      signal,
      gracefulExit: signal === 'SIGTERM',
    };
    this.eventReporter.report({
      type: 'error',
      operation: 'resource_limit_enforced',
      target: monitored.command,
      timestamp: new Date(),
      error: JSON.stringify(data),
    });
  }
}
