/**
 * State repository — Global singleton system state
 */

import type { SystemState } from '@agenshield/ipc';
import type { DbStateRow } from '../../types';
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
   * Get the current system state.
   */
  get(): SystemState | null {
    const row = this.db.prepare(Q.selectById).get() as DbStateRow | undefined;
    return row ? mapState(row) : null;
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
}
