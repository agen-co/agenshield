/**
 * Setup server — barrel exports
 */

export { createSetupServer, type SetupServer } from './server.js';
export { broadcastSetupEvent, type SetupSSEEventType } from './sse.js';
export { getUiAssetsPath } from './static.js';
export type { ExecutableInfo } from './routes.js';
