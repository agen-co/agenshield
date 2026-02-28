/**
 * CommonJS Preload Registration
 *
 * Auto-installs interceptors when loaded via -r flag.
 *
 * Usage: node -r @agenshield/interceptor/require app.js
 */

import { installInterceptors } from './installer.js';

// Install interceptors immediately
installInterceptors();

// Only log once — child processes inherit NODE_OPTIONS and would re-register
if (!process.env['AGENSHIELD_INTERCEPTOR_REGISTERED']) {
  process.env['AGENSHIELD_INTERCEPTOR_REGISTERED'] = '1';
  console.log('[AgenShield] Interceptors registered via CJS preload');
}
