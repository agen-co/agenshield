/**
 * ESM Loader Registration
 *
 * Auto-installs interceptors when loaded via --import flag.
 *
 * Usage: node --import @agenshield/interceptor/register app.js
 */

import { installInterceptors } from './installer.js';

// Install interceptors immediately
installInterceptors();

console.log('[AgenShield] Interceptors registered via ESM loader');
