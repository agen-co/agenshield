/**
 * Profile repository
 */

import * as crypto from 'node:crypto';
import type { Profile, ProfileType, InstallManifest } from '@agenshield/ipc';
import type { DbProfileRow } from '../../types';
import { BaseRepository } from '../base.repository';
import { CreateProfileSchema, ProfileSchema, UpdateProfileSchema, UpdateProfileCodec } from './profile.schema';
import type { CreateProfileInput, UpdateProfileInput } from './profile.schema';
import { mapProfile } from './profile.model';
import { Q } from './profile.query';

function generateToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

export class ProfileRepository extends BaseRepository {
  create(input: unknown): Profile {
    const data = this.validate(CreateProfileSchema, input);
    const now = this.now();

    // Auto-generate broker token for target profiles
    const brokerToken = (data.type ?? 'target') === 'target' ? generateToken() : undefined;

    const full = this.validate(ProfileSchema, { ...data, brokerToken, createdAt: now, updatedAt: now });

    this.db.prepare(Q.insert).run({
      id: full.id, name: full.name, type: full.type ?? 'target',
      targetName: full.targetName ?? null, presetId: full.presetId ?? null,
      description: full.description ?? null,
      agentUsername: full.agentUsername ?? null, agentUid: full.agentUid ?? null,
      agentHomeDir: full.agentHomeDir ?? null,
      brokerUsername: full.brokerUsername ?? null, brokerUid: full.brokerUid ?? null,
      brokerHomeDir: full.brokerHomeDir ?? null,
      brokerToken: full.brokerToken ?? null,
      installManifest: null,
      enforcementMode: full.enforcementMode ?? null,
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

  /**
   * Look up a profile by its broker token.
   */
  getByToken(token: string): Profile | null {
    const row = this.db.prepare(Q.selectByToken).get(token) as DbProfileRow | undefined;
    return row ? mapProfile(row) : null;
  }

  /**
   * Get all profiles for a given preset ID, ordered by creation time.
   */
  getByPresetId(presetId: string): Profile[] {
    return (this.db.prepare(Q.selectByPresetId).all(presetId) as DbProfileRow[]).map(mapProfile);
  }

  /**
   * Rotate the broker token for a target profile.
   * Returns the updated profile or null if not found.
   */
  rotateToken(id: string): Profile | null {
    const existing = this.getById(id);
    if (!existing) return null;
    const newToken = generateToken();
    this.buildDynamicUpdate({ broker_token: newToken }, 'profiles', 'id = @id', { id });
    return this.getById(id);
  }

  update(id: string, input: unknown): Profile | null {
    const data = this.validate(UpdateProfileSchema, input);
    if (!this.getById(id)) return null;
    const encoded = UpdateProfileCodec.encode(data);
    this.buildDynamicUpdate(encoded, 'profiles', 'id = @id', { id });
    return this.getById(id);
  }

  /**
   * Persist the install manifest for a profile.
   * Returns the updated profile or null if not found.
   */
  updateManifest(id: string, manifest: InstallManifest): Profile | null {
    if (!this.getById(id)) return null;
    this.buildDynamicUpdate(
      { install_manifest: JSON.stringify(manifest) },
      'profiles',
      'id = @id',
      { id },
    );
    return this.getById(id);
  }

  /**
   * Add a workspace path to a profile's allowed list.
   * Returns the updated profile or null if not found.
   */
  addWorkspacePath(id: string, wsPath: string): Profile | null {
    const profile = this.getById(id);
    if (!profile) return null;
    const paths = profile.workspacePaths ?? [];
    if (paths.includes(wsPath)) return profile;
    const updated = [...paths, wsPath];
    this.buildDynamicUpdate(
      { workspace_paths: JSON.stringify(updated) },
      'profiles',
      'id = @id',
      { id },
    );
    return this.getById(id);
  }

  /**
   * Remove a workspace path from a profile's allowed list.
   * Returns the updated profile or null if not found.
   */
  removeWorkspacePath(id: string, wsPath: string): Profile | null {
    const profile = this.getById(id);
    if (!profile) return null;
    const paths = profile.workspacePaths ?? [];
    const updated = paths.filter((p) => p !== wsPath);
    this.buildDynamicUpdate(
      { workspace_paths: JSON.stringify(updated) },
      'profiles',
      'id = @id',
      { id },
    );
    return this.getById(id);
  }

  delete(id: string): boolean {
    return this.db.prepare(Q.delete).run(id).changes > 0;
  }
}
