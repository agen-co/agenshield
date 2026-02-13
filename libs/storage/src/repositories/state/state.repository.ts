/**
 * State repository — Global singleton system state
 */

import type { SystemState, UserState, GroupState } from '@agenshield/ipc';
import type { DbStateRow, DbUserRow, DbGroupRow } from '../../types';
import { BaseRepository } from '../base.repository';
import { mapState } from './state.model';
import { Q } from './state.query';
import {
  UpdateDaemonSchema, UpdateDaemonCodec,
  UpdateAgenCoSchema, UpdateAgenCoCodec,
  UpdateInstallationSchema, UpdateInstallationCodec,
  UpdatePasscodeSchema, UpdatePasscodeCodec,
} from './state.schema';
import type {
  UpdateDaemonInput, UpdateAgenCoInput, UpdateInstallationInput, UpdatePasscodeInput,
} from './state.schema';

export class StateRepository extends BaseRepository {
  /**
   * Get the current system state (without users/groups — call getUsers/getGroups separately).
   */
  get(): SystemState | null {
    const row = this.db.prepare(Q.selectById).get() as DbStateRow | undefined;
    return row ? mapState(row) : null;
  }

  /**
   * Get full state including users and groups from their dedicated tables.
   */
  getFull(): SystemState | null {
    const state = this.get();
    if (!state) return null;
    state.users = this.getUsers();
    state.groups = this.getGroups();
    return state;
  }

  /**
   * Initialize state (insert singleton row).
   */
  init(version: string, installedAt?: string): void {
    this.db.prepare(Q.insert).run({
      version,
      installedAt: installedAt ?? this.now(),
    });
  }

  /**
   * Update daemon state.
   */
  updateDaemon(input: UpdateDaemonInput): void {
    const data = this.validate(UpdateDaemonSchema, input);
    const encoded = UpdateDaemonCodec.encode(data);
    this.buildDynamicUpdate(encoded, 'state', 'id = 1', {});
  }

  /**
   * Update AgenCo state.
   */
  updateAgenCo(input: UpdateAgenCoInput): void {
    const data = this.validate(UpdateAgenCoSchema, input);
    const encoded = UpdateAgenCoCodec.encode(data);
    this.buildDynamicUpdate(encoded, 'state', 'id = 1', {});
  }

  /**
   * Update installation state.
   */
  updateInstallation(input: UpdateInstallationInput): void {
    const data = this.validate(UpdateInstallationSchema, input);
    const encoded = UpdateInstallationCodec.encode(data);
    this.buildDynamicUpdate(encoded, 'state', 'id = 1', {});
  }

  /**
   * Update passcode protection state.
   */
  updatePasscode(input: UpdatePasscodeInput): void {
    const data = this.validate(UpdatePasscodeSchema, input);
    const encoded = UpdatePasscodeCodec.encode(data);
    this.buildDynamicUpdate(encoded, 'state', 'id = 1', {});
  }

  /**
   * Update the version field.
   */
  updateVersion(version: string): void {
    this.db.prepare(Q.updateVersion).run({ version, updatedAt: this.now() });
  }

  // ── Users ──────────────────────────────────────────

  /** Get all users from the users table. */
  getUsers(): UserState[] {
    const rows = this.db.prepare(Q.selectAllUsers).all() as DbUserRow[];
    return rows.map((r) => ({
      username: r.username,
      uid: r.uid,
      type: r.type as UserState['type'],
      createdAt: r.created_at,
      homeDir: r.home_dir,
    }));
  }

  /** Upsert a user (insert or replace by username). */
  addUser(user: UserState): void {
    this.db.prepare(Q.upsertUser).run({
      username: user.username,
      uid: user.uid,
      type: user.type,
      createdAt: user.createdAt,
      homeDir: user.homeDir,
    });
  }

  /** Remove a user by username. */
  removeUser(username: string): void {
    this.db.prepare(Q.deleteUser).run({ username });
  }

  // ── Groups ─────────────────────────────────────────

  /** Get all groups from the groups_ table. */
  getGroups(): GroupState[] {
    const rows = this.db.prepare(Q.selectAllGroups).all() as DbGroupRow[];
    return rows.map((r) => ({
      name: r.name,
      gid: r.gid,
      type: r.type as GroupState['type'],
    }));
  }

  /** Upsert a group (insert or replace by name). */
  addGroup(group: GroupState): void {
    this.db.prepare(Q.upsertGroup).run({
      name: group.name,
      gid: group.gid,
      type: group.type,
    });
  }

  /** Remove a group by name. */
  removeGroup(name: string): void {
    this.db.prepare(Q.deleteGroup).run({ name });
  }

  // ── Reset ──────────────────────────────────────────

  /** Delete all state, users, and groups (for factory reset). */
  resetAll(): void {
    this.db.transaction(() => {
      this.db.prepare(Q.deleteAllUsers).run();
      this.db.prepare(Q.deleteAllGroups).run();
      this.db.prepare('DELETE FROM state').run();
    })();
  }
}
