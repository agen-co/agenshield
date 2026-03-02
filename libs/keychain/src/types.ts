/**
 * Keychain types and interfaces
 */

/** Categories of items that can be stored in Keychain */
export type KeychainItemCategory = 'vault-key' | 'oauth-tokens' | 'secrets';

/** Configuration for Keychain integration */
export interface KeychainConfig {
  /** Whether Keychain integration is enabled */
  enabled: boolean;
  /** Which categories of items to store in Keychain */
  categories: KeychainItemCategory[];
  /** Whether to sync items to iCloud Keychain */
  syncToICloud: boolean;
}

/** Default Keychain configuration (disabled) */
export const DEFAULT_KEYCHAIN_CONFIG: KeychainConfig = {
  enabled: false,
  categories: [],
  syncToICloud: false,
};

/** Keychain accessibility levels (maps to kSecAttrAccessible values) */
export type KeychainAccessibility =
  | 'WhenUnlocked'
  | 'WhenUnlockedThisDeviceOnly'
  | 'AfterFirstUnlock'
  | 'AfterFirstUnlockThisDeviceOnly';

/** A Keychain item to store or retrieve */
export interface KeychainItem {
  /** Service name (e.g. 'com.frontegg.AgenShield') */
  service: string;
  /** Account identifier (e.g. 'vault-key', 'oauth-access-token') */
  account: string;
  /** The secret data (raw bytes or string) */
  data: Buffer | string;
  /** Accessibility level */
  accessible?: KeychainAccessibility;
  /** Whether to sync to iCloud Keychain */
  synchronizable?: boolean;
  /** Optional label for Keychain Access display */
  label?: string;
}

/**
 * Provider interface for secret key storage.
 * Implementations: macOS Keychain (via Swift helper), noop (file fallback).
 */
export interface KeyProvider {
  /** Store a secret in the key provider */
  set(account: string, data: Buffer | string, options?: {
    accessible?: KeychainAccessibility;
    synchronizable?: boolean;
    label?: string;
  }): Promise<boolean>;

  /** Retrieve a secret from the key provider */
  get(account: string): Promise<Buffer | null>;

  /** Delete a secret from the key provider */
  delete(account: string): Promise<boolean>;

  /** Check if a secret exists */
  has(account: string): Promise<boolean>;

  /** Whether this provider is backed by actual Keychain (vs noop) */
  readonly isKeychainBacked: boolean;
}
