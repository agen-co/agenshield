/**
 * Shield Operation Logger
 *
 * Writes detailed step-by-step logs of the entire shielding process
 * to ~/.agenshield/logs/shield-{targetId}-{timestamp}.log.
 *
 * Each entry includes timestamps, step IDs, full command text,
 * exit codes, and stdout/stderr from privilege helper operations.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

export class ShieldLogger {
  private readonly fd: number;
  readonly logPath: string;
  private readonly startTime: number;

  constructor(targetId: string) {
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const logDir = path.join(os.homedir(), '.agenshield', 'logs', targetId);
    fs.mkdirSync(logDir, { recursive: true });

    this.logPath = path.join(logDir, `shield-${ts}.log`);
    this.fd = fs.openSync(this.logPath, 'a');
    this.startTime = Date.now();

    this.write('='.repeat(72));
    this.write(`AgenShield — Shield Operation Log`);
    this.write(`Target:  ${targetId}`);
    this.write(`Started: ${new Date().toISOString()}`);
    this.write(`Host:    ${os.hostname()} (${os.platform()} ${os.release()})`);
    this.write('='.repeat(72));
    this.write('');
  }

  /** Write a plain line with timestamp. */
  private write(line: string): void {
    const elapsed = ((Date.now() - this.startTime) / 1000).toFixed(1);
    const entry = `[+${elapsed.padStart(7)}s] ${line}\n`;
    fs.writeSync(this.fd, entry);
  }

  /** Log the start of a named step. */
  step(stepId: string, message: string): void {
    this.write('');
    this.write(`── STEP: ${stepId} ──────────────────────────────────────`);
    this.write(message);
  }

  /** Log an informational message. */
  info(message: string): void {
    this.write(`  INFO  ${message}`);
  }

  /** Log a warning. */
  warn(message: string): void {
    this.write(`  WARN  ${message}`);
  }

  /** Log an error. */
  error(message: string): void {
    this.write(`  ERROR ${message}`);
  }

  /** Log a command about to be executed. */
  command(cmd: string, opts?: { user?: string; timeout?: number }): void {
    const userTag = opts?.user ? ` (as ${opts.user})` : ' (as root)';
    const timeoutTag = opts?.timeout ? ` [timeout ${opts.timeout}ms]` : '';
    this.write(`  CMD${userTag}${timeoutTag}`);
    // Truncate very long commands for readability
    const truncated = cmd.length > 2000 ? cmd.slice(0, 2000) + '... [truncated]' : cmd;
    for (const line of truncated.split('\n')) {
      this.write(`    > ${line}`);
    }
  }

  /** Log the result of a command execution. */
  result(success: boolean, output: string, error?: string, exitCode?: number): void {
    const status = success ? 'OK' : 'FAIL';
    const codeTag = exitCode !== undefined ? ` (exit ${exitCode})` : '';
    this.write(`  RESULT: ${status}${codeTag}`);

    if (output.trim()) {
      const lines = output.trim().split('\n');
      const maxLines = 50;
      const show = lines.length > maxLines ? lines.slice(0, maxLines) : lines;
      for (const line of show) {
        this.write(`    stdout: ${line}`);
      }
      if (lines.length > maxLines) {
        this.write(`    ... (${lines.length - maxLines} more lines)`);
      }
    }

    if (error?.trim()) {
      const lines = error.trim().split('\n');
      const maxLines = 30;
      const show = lines.length > maxLines ? lines.slice(0, maxLines) : lines;
      for (const line of show) {
        this.write(`    stderr: ${line}`);
      }
      if (lines.length > maxLines) {
        this.write(`    ... (${lines.length - maxLines} more lines)`);
      }
    }
  }

  /** Log plist or seatbelt profile content that was written to disk. */
  fileContent(label: string, filePath: string, content: string): void {
    this.write(`  FILE: ${label} → ${filePath}`);
    const lines = content.split('\n');
    const maxLines = 80;
    const show = lines.length > maxLines ? lines.slice(0, maxLines) : lines;
    for (const line of show) {
      this.write(`    | ${line}`);
    }
    if (lines.length > maxLines) {
      this.write(`    | ... (${lines.length - maxLines} more lines)`);
    }
  }

  /** Log a LaunchDaemon load/unload/kickstart event. */
  launchdEvent(action: 'load' | 'kickstart' | 'unload' | 'bootout', label: string, plistPath?: string): void {
    const pathTag = plistPath ? ` (${plistPath})` : '';
    this.write(`  LAUNCHD: ${action} ${label}${pathTag}`);
  }

  /** Log a process spawn event. */
  processEvent(action: 'spawning' | 'spawned' | 'crash_detected', label: string, details?: Record<string, unknown>): void {
    const extra = details ? ` ${JSON.stringify(details)}` : '';
    this.write(`  PROCESS: ${action} ${label}${extra}`);
  }

  /** Log the final outcome and close the file. */
  finish(success: boolean, message?: string): void {
    this.write('');
    this.write('='.repeat(72));
    this.write(`Finished: ${new Date().toISOString()}`);
    this.write(`Duration: ${((Date.now() - this.startTime) / 1000).toFixed(1)}s`);
    this.write(`Result:   ${success ? 'SUCCESS' : 'FAILED'}`);
    if (message) {
      this.write(`Message:  ${message}`);
    }
    this.write('='.repeat(72));

    try {
      fs.closeSync(this.fd);
    } catch {
      // Already closed
    }
  }
}
