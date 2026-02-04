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

console.log('[AgenShield] Interceptors registered via CJS preload');
