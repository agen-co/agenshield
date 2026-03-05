/**
 * Migration 029 — Add proxy_tls_reject_unauthorized column to config table
 *
 * Stores whether the proxy should reject unauthorized TLS certificates.
 * NULL inherits the daemon default (true).
 */

import type Database from 'better-sqlite3';
import type { Migration } from './types';

export class ProxyTlsMigration implements Migration {
  readonly version = 29;
  readonly name = '029-proxy-tls';

  up(db: Database.Database): void {
    db.exec(`ALTER TABLE config ADD COLUMN proxy_tls_reject_unauthorized INTEGER`);
  }
}
