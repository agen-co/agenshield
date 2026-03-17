/**
 * Cloud credential storage
 *
 * Save and load cloud credentials from ~/.agenshield/cloud.json.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { CLOUD_CONFIG } from './config';
import type { CloudCredentials } from './types';

/**
 * Save cloud credentials to ~/.agenshield/cloud.json (mode 0o600).
 */
export function saveCloudCredentials(
  agentId: string,
  privateKey: string,
  cloudUrl: string,
  companyName: string,
): void {
  const credentials: CloudCredentials = {
    agentId,
    privateKey,
    cloudUrl,
    companyName,
    registeredAt: new Date().toISOString(),
  };

  const dir = path.dirname(CLOUD_CONFIG.credentialsPath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    CLOUD_CONFIG.credentialsPath,
    JSON.stringify(credentials, null, 2) + '\n',
    { mode: 0o600 },
  );
}

/**
 * Load cloud credentials from ~/.agenshield/cloud.json.
 * Returns null if not enrolled.
 */
export function loadCloudCredentials(): CloudCredentials | null {
  try {
    const raw = fs.readFileSync(CLOUD_CONFIG.credentialsPath, 'utf-8');
    const data = JSON.parse(raw) as CloudCredentials;
    if (!data.agentId || !data.privateKey) return null;
    return data;
  } catch {
    return null;
  }
}

/**
 * Check whether this device is enrolled in AgenShield Cloud.
 */
export function isCloudEnrolled(): boolean {
  return loadCloudCredentials() !== null;
}
