/**
 * @agenshield/interceptor
 *
 * Node.js runtime interception via ESM loader and CJS preload.
 * Intercepts network, file system, and process operations to route
 * them through the AgenShield broker daemon.
 */

export { installInterceptors, uninstallInterceptors } from './installer.js';
export { InterceptorConfig, createConfig } from './config.js';

// Interceptor exports
export { FetchInterceptor } from './interceptors/fetch.js';
export { HttpInterceptor } from './interceptors/http.js';
export { WebSocketInterceptor } from './interceptors/websocket.js';
export { ChildProcessInterceptor } from './interceptors/child-process.js';
export { FsInterceptor } from './interceptors/fs.js';

// Client exports
export { AsyncClient } from './client/http-client.js';
export { SyncClient } from './client/sync-client.js';

// Policy exports
export { PolicyEvaluator } from './policy/evaluator.js';
export { PolicyCache } from './policy/cache.js';

// Event exports
export { EventReporter } from './events/reporter.js';

// Error types
export { AgenShieldError, PolicyDeniedError } from './errors.js';
