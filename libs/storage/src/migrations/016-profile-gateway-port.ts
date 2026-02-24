/**
 * Migration 016 — Add gateway_port column to profiles
 *
 * Stores the per-target gateway port allocation.
 * NULL means no gateway port is assigned (non-openclaw targets).
 */

import type Database from 'better-sqlite3';
import type { Migration } from './types';

export class ProfileGatewayPortMigration implements Migration {
  readonly version = 16;
  readonly name = '016-profile-gateway-port';

  up(db: Database.Database): void {
    db.exec(`
      ALTER TABLE profiles ADD COLUMN gateway_port INTEGER
    `);
  }
}
