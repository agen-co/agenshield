/**
 * Migration system types
 */

import type Database from 'better-sqlite3';

export interface Migration {
  readonly version: number;
  readonly name: string;
  up(db: Database.Database, encryptionKey: Buffer | null): void;
}
