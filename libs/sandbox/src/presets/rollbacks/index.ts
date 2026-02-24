/**
 * Rollback Handlers Registration
 *
 * Importing this module registers all infra and preset rollback handlers.
 */

import './infra.js';
import './preset.js';

/** No-op marker — import this module for side effects */
export const ROLLBACK_HANDLERS_REGISTERED = true;
