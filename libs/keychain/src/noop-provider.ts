/**
 * Noop KeyProvider — fallback for Linux/CI/dev when Keychain is not available.
 *
 * Returns null for all operations, never throws. The caller falls back
 * to file-based storage when this provider returns null.
 */

import type { KeyProvider } from './types';

export class NoopKeyProvider implements KeyProvider {
  readonly isKeychainBacked = false;

  async set(): Promise<boolean> {
    return false;
  }

  async get(): Promise<Buffer | null> {
    return null;
  }

  async delete(): Promise<boolean> {
    return false;
  }

  async has(): Promise<boolean> {
    return false;
  }
}
