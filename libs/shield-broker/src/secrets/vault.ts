/**
 * Secret Vault
 *
 * Encrypted secrets storage and retrieval.
 */

import * as fs from 'node:fs/promises';
import * as crypto from 'node:crypto';

export interface VaultOptions {
  vaultPath: string;
  keyPath?: string;
}

export interface VaultSecret {
  name: string;
  value: string;
  createdAt: Date;
  lastAccessedAt?: Date;
  accessCount: number;
}

interface VaultData {
  version: string;
  secrets: Record<string, EncryptedSecret>;
}

interface EncryptedSecret {
  encrypted: string;
  iv: string;
  tag: string;
  createdAt: string;
  accessCount: number;
}

export class SecretVault {
  private vaultPath: string;
  private key: Buffer | null = null;
  private data: VaultData | null = null;

  constructor(options: VaultOptions) {
    this.vaultPath = options.vaultPath;
  }

  /**
   * Initialize the vault
   */
  async initialize(): Promise<void> {
    // Generate or load encryption key
    this.key = await this.loadOrCreateKey();

    // Load vault data
    await this.load();
  }

  /**
   * Load or create the encryption key
   */
  private async loadOrCreateKey(): Promise<Buffer> {
    const keyPath = this.vaultPath.replace('.enc', '.key');

    try {
      const keyData = await fs.readFile(keyPath);
      return keyData;
    } catch {
      // Generate new key
      const key = crypto.randomBytes(32);
      await fs.writeFile(keyPath, key, { mode: 0o600 });
      return key;
    }
  }

  /**
   * Load vault data from disk
   */
  private async load(): Promise<void> {
    try {
      const content = await fs.readFile(this.vaultPath, 'utf-8');
      this.data = JSON.parse(content);
    } catch {
      // Initialize empty vault
      this.data = {
        version: '1.0.0',
        secrets: {},
      };
    }
  }

  /**
   * Save vault data to disk
   */
  private async save(): Promise<void> {
    if (!this.data) return;

    await fs.writeFile(
      this.vaultPath,
      JSON.stringify(this.data, null, 2),
      { mode: 0o600 }
    );
  }

  /**
   * Encrypt a value
   */
  private encrypt(value: string): { encrypted: string; iv: string; tag: string } {
    if (!this.key) {
      throw new Error('Vault not initialized');
    }

    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.key, iv);

    let encrypted = cipher.update(value, 'utf-8', 'base64');
    encrypted += cipher.final('base64');

    const tag = cipher.getAuthTag();

    return {
      encrypted,
      iv: iv.toString('base64'),
      tag: tag.toString('base64'),
    };
  }

  /**
   * Decrypt a value
   */
  private decrypt(encrypted: string, iv: string, tag: string): string {
    if (!this.key) {
      throw new Error('Vault not initialized');
    }

    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      this.key,
      Buffer.from(iv, 'base64')
    );

    decipher.setAuthTag(Buffer.from(tag, 'base64'));

    let decrypted = decipher.update(encrypted, 'base64', 'utf-8');
    decrypted += decipher.final('utf-8');

    return decrypted;
  }

  /**
   * Get a secret by name
   */
  async get(name: string): Promise<VaultSecret | null> {
    if (!this.data) {
      await this.initialize();
    }

    const entry = this.data!.secrets[name];
    if (!entry) {
      return null;
    }

    try {
      const value = this.decrypt(entry.encrypted, entry.iv, entry.tag);

      // Update access stats
      entry.accessCount++;
      await this.save();

      return {
        name,
        value,
        createdAt: new Date(entry.createdAt),
        lastAccessedAt: new Date(),
        accessCount: entry.accessCount,
      };
    } catch (error) {
      console.error(`Failed to decrypt secret ${name}:`, error);
      return null;
    }
  }

  /**
   * Set a secret
   */
  async set(name: string, value: string): Promise<void> {
    if (!this.data) {
      await this.initialize();
    }

    const encrypted = this.encrypt(value);

    this.data!.secrets[name] = {
      ...encrypted,
      createdAt: new Date().toISOString(),
      accessCount: 0,
    };

    await this.save();
  }

  /**
   * Delete a secret
   */
  async delete(name: string): Promise<boolean> {
    if (!this.data) {
      await this.initialize();
    }

    if (this.data!.secrets[name]) {
      delete this.data!.secrets[name];
      await this.save();
      return true;
    }

    return false;
  }

  /**
   * List all secret names
   */
  async list(): Promise<string[]> {
    if (!this.data) {
      await this.initialize();
    }

    return Object.keys(this.data!.secrets);
  }

  /**
   * Check if a secret exists
   */
  async has(name: string): Promise<boolean> {
    if (!this.data) {
      await this.initialize();
    }

    return name in this.data!.secrets;
  }
}
