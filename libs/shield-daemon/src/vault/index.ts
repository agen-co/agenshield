/**
 * Encrypted vault manager
 *
 * Provides secure storage for sensitive data like OAuth tokens
 * using machine-specific encryption.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { VaultContents } from '@agenshield/ipc';
import { VAULT_FILE } from '@agenshield/ipc';
import { getMachineId, deriveKey, encrypt, decrypt } from './crypto';
import { getConfigDir } from '../config/paths';

/**
 * Vault manager class for encrypted storage
 */
export class Vault {
  private key: Buffer;
  private vaultPath: string;
  private cache: VaultContents | null = null;

  constructor() {
    const machineId = getMachineId();
    this.key = deriveKey(machineId);
    this.vaultPath = path.join(getConfigDir(), VAULT_FILE);
  }

  /**
   * Load vault contents from disk
   * Returns cached contents if available
   */
  async load(): Promise<VaultContents> {
    if (this.cache) {
      return this.cache;
    }

    // Return default contents if vault doesn't exist
    if (!fs.existsSync(this.vaultPath)) {
      this.cache = this.getDefaultContents();
      return this.cache;
    }

    try {
      const encrypted = fs.readFileSync(this.vaultPath, 'utf-8');
      const decrypted = decrypt(encrypted, this.key);
      this.cache = JSON.parse(decrypted);
      return this.cache!;
    } catch (error) {
      // If decryption fails (wrong machine, corrupted file), return defaults
      console.error('Failed to decrypt vault, initializing empty vault:', (error as Error).message);
      this.cache = this.getDefaultContents();
      return this.cache;
    }
  }

  /**
   * Save vault contents to disk
   */
  async save(contents: VaultContents): Promise<void> {
    const configDir = getConfigDir();

    // Ensure config directory exists
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true, mode: 0o700 });
    }

    const json = JSON.stringify(contents, null, 2);
    const encrypted = encrypt(json, this.key);

    // Write with restrictive permissions (owner read/write only)
    fs.writeFileSync(this.vaultPath, encrypted, { mode: 0o600 });
    this.cache = contents;
  }

  /**
   * Get a specific key from vault
   */
  async get<K extends keyof VaultContents>(key: K): Promise<VaultContents[K]> {
    const contents = await this.load();
    return contents[key];
  }

  /**
   * Set a specific key in vault
   */
  async set<K extends keyof VaultContents>(key: K, value: VaultContents[K]): Promise<void> {
    const contents = await this.load();
    contents[key] = value;
    await this.save(contents);
  }

  /**
   * Delete a specific key from vault
   */
  async delete<K extends keyof VaultContents>(key: K): Promise<void> {
    const contents = await this.load();
    delete contents[key];
    await this.save(contents);
  }

  /**
   * Check if vault file exists
   */
  exists(): boolean {
    return fs.existsSync(this.vaultPath);
  }

  /**
   * Clear the in-memory cache
   * Useful for testing or when vault file is modified externally
   */
  clearCache(): void {
    this.cache = null;
  }

  /**
   * Delete the vault file entirely
   */
  async destroy(): Promise<void> {
    if (fs.existsSync(this.vaultPath)) {
      fs.unlinkSync(this.vaultPath);
    }
    this.cache = null;
  }

  /**
   * Get default empty vault contents
   */
  private getDefaultContents(): VaultContents {
    return {
      envSecrets: {},
      sensitivePatterns: [],
    };
  }
}

// Singleton instance
let vaultInstance: Vault | null = null;

/**
 * Get the singleton vault instance
 */
export function getVault(): Vault {
  if (!vaultInstance) {
    vaultInstance = new Vault();
  }
  return vaultInstance;
}

/**
 * Reset the vault singleton (for testing)
 */
export function resetVault(): void {
  vaultInstance = null;
}

// Re-export crypto utilities for convenience
export { getMachineId, deriveKey, encrypt, decrypt } from './crypto';
