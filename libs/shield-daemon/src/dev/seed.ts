/**
 * Dev mode seeding — Creates default profiles and policies for development.
 *
 * Only runs when `isDevMode()` is true (AGENSHIELD_AGENT_HOME is set).
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Storage } from '@agenshield/storage';

interface DevProfile {
  id: string;
  name: string;
  type: 'target';
  targetName: string;
  presetId?: string;
  description: string;
  agentUsername: string;
  agentUid: number;
  agentHomeDir: string;
  brokerUsername: string;
  brokerUid: number;
  brokerHomeDir: string;
}

/**
 * Seed development data into storage:
 * 1. Dev profiles (target type)
 * 2. Preset policies for profiles that have a presetId
 */
export function seedDevData(storage: Storage): void {
  const agentHome = process.env['AGENSHIELD_AGENT_HOME'] || '/tmp/dev-agent';
  const devBase = path.dirname(agentHome); // e.g. "./tmp"

  const DEV_PROFILES: DevProfile[] = [
    {
      id: 'openclaw',
      name: 'OpenClaw',
      type: 'target',
      targetName: 'openclaw',
      presetId: 'openclaw',
      description: 'Default dev target',
      agentUsername: 'dev-agent',
      agentUid: 1001,
      agentHomeDir: agentHome,
      brokerUsername: 'dev-broker',
      brokerUid: 1002,
      brokerHomeDir: path.join(devBase, 'dev-broker'),
    },
    {
      id: 'cloudcode',
      name: 'CloudCode',
      type: 'target',
      targetName: 'cloudcode',
      description: 'Secondary dev target for testing multi-profile',
      agentUsername: 'cc-agent',
      agentUid: 2001,
      agentHomeDir: path.join(devBase, 'cc-agent'),
      brokerUsername: 'cc-broker',
      brokerUid: 2002,
      brokerHomeDir: path.join(devBase, 'cc-broker'),
    },
  ];

  // 1. Create profiles if they don't exist + ensure dirs on disk
  for (const profile of DEV_PROFILES) {
    if (!storage.profiles.getById(profile.id)) {
      storage.profiles.create(profile);
      console.log(`[Seed] Created profile: ${profile.id}`);
    }

    // Ensure each profile's agent/broker home dirs exist
    for (const dir of [
      profile.agentHomeDir,
      path.join(profile.agentHomeDir, 'bin'),
      path.join(profile.agentHomeDir, '.openclaw', 'workspace', 'skills'),
      profile.brokerHomeDir,
    ]) {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
        console.log(`[Seed] Created dir: ${dir}`);
      }
    }
  }

  // 2. Seed preset policies for profiles that have a presetId
  for (const profile of DEV_PROFILES) {
    if (!profile.presetId) continue;
    const scoped = storage.for({ profileId: profile.id });
    const seeded = scoped.policies.seedPreset(profile.presetId);
    if (seeded > 0) {
      console.log(`[Seed] Seeded ${seeded} ${profile.presetId} preset policies`);
    }
  }
}
