/**
 * Profile repository
 */

import type { Profile, ProfileType } from '@agenshield/ipc';
import type { DbProfileRow } from '../../types';
import { BaseRepository } from '../base.repository';
import { CreateProfileSchema, ProfileSchema, UpdateProfileSchema, UpdateProfileCodec } from './profile.schema';
import type { CreateProfileInput, UpdateProfileInput } from './profile.schema';
import { mapProfile } from './profile.model';
import { Q } from './profile.query';

export class ProfileRepository extends BaseRepository {
  create(input: unknown): Profile {
    const data = this.validate(CreateProfileSchema, input);
    const now = this.now();
    const full = this.validate(ProfileSchema, { ...data, createdAt: now, updatedAt: now });

    this.db.prepare(Q.insert).run({
      id: full.id, name: full.name, type: full.type ?? 'target',
      targetName: full.targetName ?? null, presetId: full.presetId ?? null,
      description: full.description ?? null,
      agentUsername: full.agentUsername ?? null, agentUid: full.agentUid ?? null,
      agentHomeDir: full.agentHomeDir ?? null,
      brokerUsername: full.brokerUsername ?? null, brokerUid: full.brokerUid ?? null,
      brokerHomeDir: full.brokerHomeDir ?? null,
      createdAt: full.createdAt, updatedAt: full.updatedAt,
    });
    return full;
  }

  getById(id: string): Profile | null {
    const row = this.db.prepare(Q.selectById).get(id) as DbProfileRow | undefined;
    return row ? mapProfile(row) : null;
  }

  getAll(): Profile[] {
    return (this.db.prepare(Q.selectAll).all() as DbProfileRow[]).map(mapProfile);
  }

  getByType(type: ProfileType): Profile[] {
    return (this.db.prepare(Q.selectByType).all(type) as DbProfileRow[]).map(mapProfile);
  }

  getGlobal(): Profile | null {
    const row = this.db.prepare(Q.selectGlobal).get() as DbProfileRow | undefined;
    return row ? mapProfile(row) : null;
  }

  update(id: string, input: unknown): Profile | null {
    const data = this.validate(UpdateProfileSchema, input);
    if (!this.getById(id)) return null;
    const encoded = UpdateProfileCodec.encode(data);
    this.buildDynamicUpdate(encoded, 'profiles', 'id = @id', { id });
    return this.getById(id);
  }

  delete(id: string): boolean {
    return this.db.prepare(Q.delete).run(id).changes > 0;
  }
}
