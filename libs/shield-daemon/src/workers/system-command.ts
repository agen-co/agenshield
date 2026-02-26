/**
 * System Command Executor — main-thread interface to the worker thread.
 *
 * Offloads all execSync/exec calls to a dedicated Worker, preventing
 * event loop stalls from system commands (ps, df, netstat, launchctl, etc.).
 *
 * Singleton pattern: initSystemExecutor() / getSystemExecutor() / shutdownSystemExecutor()
 */

import { Worker } from 'node:worker_threads';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getLogger } from '../logger';

// ESM-compatible __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface ExecOptions {
  timeout?: number;
}

interface PendingCallback {
  resolve: (stdout: string) => void;
  reject: (error: Error) => void;
}

interface WorkerSuccessResponse {
  id: number;
  stdout: string;
  stderr: string;
}

interface WorkerErrorResponse {
  id: number;
  error: string;
  stderr: string;
  code?: string;
}

type WorkerResponse = WorkerSuccessResponse | WorkerErrorResponse;

export class SystemCommandExecutor {
  private worker: Worker;
  private pending = new Map<number, PendingCallback>();
  private nextId = 1;
  private alive = true;

  constructor() {
    // When bundled, __dirname is the bundle root (dist/) but the worker
    // lives in dist/workers/. In unbundled dev, both files are in the same dir.
    const candidateSubdir = path.join(__dirname, 'workers', 'system-command.worker.js');
    const candidateSame = path.join(__dirname, 'system-command.worker.js');
    const workerPath = fs.existsSync(candidateSubdir) ? candidateSubdir : candidateSame;
    this.worker = new Worker(workerPath);

    this.worker.on('message', (msg: WorkerResponse) => {
      const cb = this.pending.get(msg.id);
      if (!cb) return;
      this.pending.delete(msg.id);

      if ('error' in msg) {
        cb.reject(new Error(msg.error));
      } else {
        cb.resolve(msg.stdout);
      }
    });

    this.worker.on('error', (err) => {
      getLogger().error({ err }, '[system-executor] Worker error');
      // Reject all pending callbacks
      for (const [id, cb] of this.pending) {
        cb.reject(new Error(`Worker error: ${err.message}`));
        this.pending.delete(id);
      }
    });

    this.worker.on('exit', (code) => {
      this.alive = false;
      if (code !== 0) {
        getLogger().warn(`[system-executor] Worker exited with code ${code}`);
      }
      // Reject all pending callbacks
      for (const [id, cb] of this.pending) {
        cb.reject(new Error(`Worker exited with code ${code}`));
        this.pending.delete(id);
      }
    });
  }

  /**
   * Execute a system command in the worker thread.
   * Returns the trimmed stdout on success.
   */
  exec(command: string, options?: ExecOptions): Promise<string> {
    if (!this.alive) {
      return Promise.reject(new Error('Worker is not running'));
    }

    const id = this.nextId++;
    return new Promise<string>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({
        type: 'exec',
        id,
        command,
        options: {
          timeout: options?.timeout ?? 10_000,
        },
      });
    });
  }

  /**
   * Gracefully shut down the worker thread.
   */
  async shutdown(): Promise<void> {
    if (!this.alive) return;
    this.worker.postMessage({ type: 'shutdown' });
    await this.worker.terminate();
    this.alive = false;
  }
}

// ── Singleton ────────────────────────────────────────────────────

let instance: SystemCommandExecutor | null = null;

/**
 * Initialize the singleton system command executor.
 * Call early in daemon startup, before any watchers.
 */
export function initSystemExecutor(): SystemCommandExecutor {
  if (instance) return instance;
  instance = new SystemCommandExecutor();
  getLogger().info('[system-executor] Worker thread initialized');
  return instance;
}

/**
 * Get the singleton system command executor.
 * Throws if not initialized.
 */
export function getSystemExecutor(): SystemCommandExecutor {
  if (!instance) {
    throw new Error('SystemCommandExecutor not initialized — call initSystemExecutor() first');
  }
  return instance;
}

/**
 * Shut down the singleton executor.
 */
export async function shutdownSystemExecutor(): Promise<void> {
  if (instance) {
    await instance.shutdown();
    instance = null;
  }
}
