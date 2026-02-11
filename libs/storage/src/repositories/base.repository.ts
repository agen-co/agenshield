/**
 * Abstract base repository
 *
 * Provides common utilities: DB access, encryption, Zod validation, ID generation.
 */

import type Database from 'better-sqlite3';
import type { ScopeFilter } from '@agenshield/ipc';
import * as crypto from 'node:crypto';
import { z } from 'zod';
import { encrypt, decrypt } from '../crypto';
import { StorageLockedError, ValidationError } from '../errors';

export abstract class BaseRepository {
  constructor(
    protected readonly db: Database.Database,
    protected readonly getEncryptionKey: () => Buffer | null,
    protected readonly scope?: ScopeFilter,
  ) {}

  /**
   * Validate data against a Zod schema. Throws ValidationError on failure.
   */
  protected validate<T>(schema: z.ZodType<T>, data: unknown): T {
    const result = schema.safeParse(data);
    if (!result.success) {
      throw new ValidationError(
        `Validation failed: ${result.error.message}`,
        result.error.issues,
      );
    }
    return result.data;
  }

  /**
   * Encrypt a plaintext value. Throws StorageLockedError if no key available.
   */
  protected encrypt(plaintext: string): string {
    const key = this.getEncryptionKey();
    if (!key) throw new StorageLockedError();
    return encrypt(plaintext, key);
  }

  /**
   * Decrypt a ciphertext value. Throws StorageLockedError if no key available.
   */
  protected decrypt(ciphertext: string): string {
    const key = this.getEncryptionKey();
    if (!key) throw new StorageLockedError();
    return decrypt(ciphertext, key);
  }

  /**
   * Check if the vault is currently unlocked (encryption key available).
   */
  protected isUnlocked(): boolean {
    return this.getEncryptionKey() !== null;
  }

  /**
   * Generate a new UUID v4.
   */
  protected generateId(): string {
    return crypto.randomUUID();
  }

  /**
   * Get current ISO datetime string.
   */
  protected now(): string {
    return new Date().toISOString();
  }

  /**
   * Build and execute a dynamic UPDATE from an encoded params object.
   * Skips undefined values — only defined fields become SET clauses.
   * Appends `updated_at = @updatedAt` unless `skipTimestamp` is true.
   */
  protected buildDynamicUpdate(
    encoded: Record<string, unknown>,
    table: string,
    whereClause: string,
    whereParams: Record<string, unknown>,
    opts?: { skipTimestamp?: boolean },
  ): void {
    const entries = Object.entries(encoded).filter(([, v]) => v !== undefined);
    if (entries.length === 0) return;

    const sets = entries.map(([col]) => `${col} = @${col}`);
    const params: Record<string, unknown> = { ...whereParams };

    if (!opts?.skipTimestamp) {
      sets.push('updated_at = @updatedAt');
      params.updatedAt = this.now();
    }

    for (const [col, val] of entries) {
      params[col] = val;
    }

    this.db.prepare(`UPDATE ${table} SET ${sets.join(', ')} WHERE ${whereClause}`).run(params);
  }
}
