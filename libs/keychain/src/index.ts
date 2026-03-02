/**
 * @agenshield/keychain — Platform-aware key provider
 *
 * On macOS: Uses Security.framework via a Swift helper binary.
 * On Linux/CI/dev: Returns a noop provider that falls back to file storage.
 *
 * @packageDocumentation
 */

export type {
  KeyProvider,
  KeychainConfig,
  KeychainItemCategory,
  KeychainItem,
  KeychainAccessibility,
} from './types';

export { DEFAULT_KEYCHAIN_CONFIG } from './types';

export {
  KeychainError,
  KeychainNotAvailableError,
  KeychainAccessDeniedError,
  KeychainItemNotFoundError,
} from './errors';

export { MacOSKeyProvider } from './macos-provider';
export { NoopKeyProvider } from './noop-provider';

import type { KeyProvider } from './types';
import { MacOSKeyProvider } from './macos-provider';
import { NoopKeyProvider } from './noop-provider';

/**
 * Create the appropriate KeyProvider for the current platform.
 *
 * - macOS + helper binary found → MacOSKeyProvider (Keychain-backed)
 * - macOS + no helper → NoopKeyProvider (file fallback, no errors)
 * - Linux/other → NoopKeyProvider
 */
export function createKeyProvider(service?: string): KeyProvider {
  if (process.platform === 'darwin') {
    const provider = MacOSKeyProvider.tryCreate(service);
    if (provider) return provider;
  }
  return new NoopKeyProvider();
}
