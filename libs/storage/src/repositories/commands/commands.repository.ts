/**
 * Commands repository — Allowed commands CRUD
 */

import type { AllowedCommand } from '@agenshield/ipc';
import { CreateAllowedCommandSchema } from '@agenshield/ipc';
import type { CreateAllowedCommandInput } from '@agenshield/ipc';
import type { DbAllowedCommandRow } from '../../types';
import { BaseRepository } from '../base.repository';
import { mapCommand } from './commands.model';
import { Q } from './commands.query';

export class CommandsRepository extends BaseRepository {
  /**
   * Create or update an allowed command.
   */
  create(input: CreateAllowedCommandInput): AllowedCommand {
    const data = this.validate(CreateAllowedCommandSchema, input);
    const now = this.now();

    this.db.prepare(Q.insert).run({
      name: data.name,
      paths: JSON.stringify(data.paths),
      addedAt: now,
      addedBy: data.addedBy,
      category: data.category ?? null,
    });

    return { ...data, paths: data.paths ?? [], addedBy: data.addedBy ?? 'policy', addedAt: now };
  }

  /**
   * Get an allowed command by name.
   */
  getByName(name: string): AllowedCommand | null {
    const row = this.db.prepare(Q.selectByName).get(name) as DbAllowedCommandRow | undefined;
    return row ? mapCommand(row) : null;
  }

  /**
   * Get all allowed commands, optionally filtered by category.
   */
  getAll(category?: string): AllowedCommand[] {
    if (category) {
      const rows = this.db.prepare(Q.selectByCategory).all(category) as DbAllowedCommandRow[];
      return rows.map(mapCommand);
    }
    const rows = this.db.prepare(Q.selectAll).all() as DbAllowedCommandRow[];
    return rows.map(mapCommand);
  }

  /**
   * Delete an allowed command by name.
   */
  delete(name: string): boolean {
    const result = this.db.prepare(Q.deleteByName).run(name);
    return result.changes > 0;
  }

  /**
   * Check if a command is allowed.
   */
  isAllowed(name: string): boolean {
    const row = this.db.prepare(Q.existsByName).get(name);
    return !!row;
  }
}
