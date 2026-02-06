/**
 * Interceptor Installation
 *
 * Install and uninstall runtime interceptors.
 */

import type { InterceptorConfig } from './config.js';
import { createConfig } from './config.js';
import { FetchInterceptor } from './interceptors/fetch.js';
import { HttpInterceptor } from './interceptors/http.js';
import { WebSocketInterceptor } from './interceptors/websocket.js';
import { ChildProcessInterceptor } from './interceptors/child-process.js';
import { FsInterceptor } from './interceptors/fs.js';
import { AsyncClient } from './client/http-client.js';
import { PolicyEvaluator } from './policy/evaluator.js';
import { EventReporter } from './events/reporter.js';

interface InstalledInterceptors {
  fetch?: FetchInterceptor;
  http?: HttpInterceptor;
  websocket?: WebSocketInterceptor;
  childProcess?: ChildProcessInterceptor;
  fs?: FsInterceptor;
}

let installed: InstalledInterceptors | null = null;
let client: AsyncClient | null = null;
let policyEvaluator: PolicyEvaluator | null = null;
let eventReporter: EventReporter | null = null;

/**
 * Install all configured interceptors
 */
export function installInterceptors(
  configOverrides?: Partial<InterceptorConfig>
): void {
  if (installed) {
    console.warn('AgenShield interceptors already installed');
    return;
  }

  const config = createConfig(configOverrides);

  // Initialize shared components
  client = new AsyncClient({
    socketPath: config.socketPath,
    httpHost: config.httpHost,
    httpPort: config.httpPort,
    timeout: config.timeout,
  });

  policyEvaluator = new PolicyEvaluator({
    client,
  });

  eventReporter = new EventReporter({
    client,
    logLevel: config.logLevel,
  });

  installed = {};

  // Install fetch interceptor
  if (config.interceptFetch) {
    installed.fetch = new FetchInterceptor({
      client,
      policyEvaluator,
      eventReporter,
      failOpen: config.failOpen,
    });
    installed.fetch.install();
    log(config, 'debug', 'Installed fetch interceptor');
  }

  // Install http/https interceptor
  if (config.interceptHttp) {
    installed.http = new HttpInterceptor({
      client,
      policyEvaluator,
      eventReporter,
      failOpen: config.failOpen,
    });
    installed.http.install();
    log(config, 'debug', 'Installed http/https interceptor');
  }

  // Install WebSocket interceptor
  if (config.interceptWs) {
    installed.websocket = new WebSocketInterceptor({
      client,
      policyEvaluator,
      eventReporter,
      failOpen: config.failOpen,
    });
    installed.websocket.install();
    log(config, 'debug', 'Installed WebSocket interceptor');
  }

  // Install child_process interceptor
  if (config.interceptExec) {
    installed.childProcess = new ChildProcessInterceptor({
      client,
      policyEvaluator,
      eventReporter,
      failOpen: config.failOpen,
    });
    installed.childProcess.install();
    log(config, 'debug', 'Installed child_process interceptor');
  }

  // Install fs interceptor
  if (config.interceptFs) {
    installed.fs = new FsInterceptor({
      client,
      policyEvaluator,
      eventReporter,
      failOpen: config.failOpen,
    });
    installed.fs.install();
    log(config, 'debug', 'Installed fs interceptor');
  }

  log(config, 'info', 'AgenShield interceptors installed');
}

/**
 * Uninstall all interceptors
 */
export function uninstallInterceptors(): void {
  if (!installed) {
    return;
  }

  if (installed.fetch) {
    installed.fetch.uninstall();
  }

  if (installed.http) {
    installed.http.uninstall();
  }

  if (installed.websocket) {
    installed.websocket.uninstall();
  }

  if (installed.childProcess) {
    installed.childProcess.uninstall();
  }

  if (installed.fs) {
    installed.fs.uninstall();
  }

  installed = null;
  client = null;
  policyEvaluator = null;
  eventReporter = null;
}

/**
 * Check if interceptors are installed
 */
export function isInstalled(): boolean {
  return installed !== null;
}

/**
 * Get the broker client
 */
export function getClient(): AsyncClient | null {
  return client;
}

/**
 * Log helper
 */
function log(
  config: InterceptorConfig,
  level: 'debug' | 'info' | 'warn' | 'error',
  message: string
): void {
  const levels = { debug: 0, info: 1, warn: 2, error: 3 };
  if (levels[level] >= levels[config.logLevel]) {
    console[level](`[AgenShield] ${message}`);
  }
}
