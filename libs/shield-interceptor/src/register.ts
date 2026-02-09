/**
 * ESM Loader Registration
 *
 * Auto-installs interceptors when loaded via --import flag.
 *
 * Usage: node --import @agenshield/interceptor/register app.js
 */

import { installInterceptors } from './installer.js';

// Install interceptors immediately
try {
  installInterceptors();
  console.log('[AgenShield] Interceptors registered via ESM loader');
} catch (error) {
  console.error('[AgenShield] FATAL: Failed to install interceptors:', (error as Error).message);
  console.error('[AgenShield] Stack:', (error as Error).stack);
}
