/**
 * Setup guard
 *
 * Ensures that `agenshield setup` has been completed before allowing
 * commands that depend on a working installation to run.
 */

import { isSetupComplete } from './setup-state.js';
import { SetupRequiredError } from '../errors.js';

/**
 * Throws `SetupRequiredError` when setup has not been completed.
 *
 * Add this as the first call inside `.action()` for any command that
 * requires a working AgenShield installation.
 */
export function ensureSetupComplete(): void {
  if (!isSetupComplete()) {
    throw new SetupRequiredError();
  }
}
