/**
 * Target repository
 */

import type { Target, TargetUser } from '@agenshield/ipc';
import type { DbTargetRow, DbTargetUserRow } from '../../types';
import { BaseRepository } from '../base.repository';
import { CreateTargetSchema, TargetSchema, CreateTargetUserSchema, TargetUserSchema, UpdateTargetSchema, UpdateTargetCodec } from './target.schema';
import type { CreateTargetInput, CreateTargetUserInput, UpdateTargetInput, RemoveUserParams } from './target.schema';
import { mapTarget, mapTargetUser } from './target.model';
import { Q } from './target.query';

export class TargetRepository extends BaseRepository {
  create(input: CreateTargetInput): Target {
    const data = this.validate(CreateTargetSchema, input);
    const now = this.now();
    const full = this.validate(TargetSchema, { ...data, createdAt: now, updatedAt: now });

    this.db.prepare(Q.insert).run({
      id: full.id, name: full.name,
      presetId: full.presetId ?? null, description: full.description ?? null,
      createdAt: full.createdAt, updatedAt: full.updatedAt,
    });
    return full;
  }

  getById(id: string): Target | null {
    const row = this.db.prepare(Q.selectById).get(id) as DbTargetRow | undefined;
    return row ? mapTarget(row) : null;
  }

  getAll(): Target[] {
    return (this.db.prepare(Q.selectAll).all() as DbTargetRow[]).map(mapTarget);
  }

  update(id: string, input: UpdateTargetInput): Target | null {
    const data = this.validate(UpdateTargetSchema, input);
    if (!this.getById(id)) return null;
    const encoded = UpdateTargetCodec.encode(data);
    this.buildDynamicUpdate(encoded, 'targets', 'id = @id', { id });
    return this.getById(id);
  }

  delete(id: string): boolean {
    return this.db.prepare(Q.delete).run(id).changes > 0;
  }

  addUser(input: CreateTargetUserInput): TargetUser {
    const data = this.validate(CreateTargetUserSchema, input);
    const now = this.now();
    const full = this.validate(TargetUserSchema, { ...data, createdAt: now });
    this.db.prepare(Q.insertUser).run({ targetId: full.targetId, userUsername: full.userUsername, role: full.role, createdAt: full.createdAt });
    return full;
  }

  removeUser(params: RemoveUserParams): boolean {
    return this.db.prepare(Q.deleteUser).run(params.targetId, params.userUsername).changes > 0;
  }

  getUsers(targetId: string): TargetUser[] {
    return (this.db.prepare(Q.selectUsers).all(targetId) as DbTargetUserRow[]).map(mapTargetUser);
  }
}
