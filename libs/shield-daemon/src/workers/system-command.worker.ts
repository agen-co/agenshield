/**
 * Worker thread script for executing system commands off the main event loop.
 *
 * Receives messages of type { type: 'exec', id, command, options? }
 * and responds with { id, stdout, stderr } or { id, error, stderr }.
 *
 * Uses child_process.exec (async within the worker) so it does not
 * block the main thread's event loop.
 */

import { parentPort } from 'node:worker_threads';
import { exec } from 'node:child_process';

if (!parentPort) {
  throw new Error('system-command.worker.ts must be run as a worker thread');
}

interface ExecMessage {
  type: 'exec';
  id: number;
  command: string;
  options?: {
    timeout?: number;
    encoding?: string;
  };
}

interface ShutdownMessage {
  type: 'shutdown';
}

type WorkerMessage = ExecMessage | ShutdownMessage;

parentPort.on('message', (msg: WorkerMessage) => {
  if (msg.type === 'shutdown') {
    process.exit(0);
  }

  if (msg.type === 'exec') {
    const timeout = msg.options?.timeout ?? 10_000;
    exec(msg.command, { encoding: 'utf-8', timeout, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        parentPort!.postMessage({
          id: msg.id,
          error: error.message,
          stderr: stderr || '',
          code: (error as NodeJS.ErrnoException).code,
        });
      } else {
        parentPort!.postMessage({
          id: msg.id,
          stdout: stdout || '',
          stderr: stderr || '',
        });
      }
    });
  }
});
