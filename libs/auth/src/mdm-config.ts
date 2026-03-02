/**
 * MDM org config reader/writer
 *
 * Reads and writes the MDM org configuration at ~/.agenshield/mdm.json.
 * This config is written during MDM installation and read by the daemon
 * at boot to trigger the OAuth2 device code enrollment flow.
 *
 * Constants and types are defined locally to avoid a dependency on
 * @agenshield/ipc (auth is a lower-level library). The canonical
 * duplicates live in shield-ipc's constants.ts and types/config.ts.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

/** Resolve user home — mirrors @agenshield/ipc resolveUserHome() */
function resolveUserHome(): string {
  return process.env['AGENSHIELD_USER_HOME'] || process.env['HOME'] || os.homedir();
}

const MDM_CONFIG_FILE = 'mdm.json';

function getMdmConfigPath(): string {
  return path.join(resolveUserHome(), '.agenshield', MDM_CONFIG_FILE);
}

/**
 * MDM org-based enrollment configuration.
 * Mirrors @agenshield/ipc MdmOrgConfig.
 */
export interface MdmOrgConfig {
  orgClientId: string;
  cloudUrl: string;
  createdAt: string;
}

/**
 * Load the MDM org config from ~/.agenshield/mdm.json.
 * Returns null if the file doesn't exist or is invalid.
 */
export function loadMdmConfig(): MdmOrgConfig | null {
  try {
    const raw = fs.readFileSync(getMdmConfigPath(), 'utf-8');
    const data = JSON.parse(raw) as MdmOrgConfig;
    if (!data.orgClientId || !data.cloudUrl) return null;
    return data;
  } catch {
    return null;
  }
}

/**
 * Save the MDM org config to ~/.agenshield/mdm.json.
 * Creates the parent directory if needed (no sudo required).
 */
export function saveMdmConfig(config: MdmOrgConfig): void {
  const configPath = getMdmConfigPath();
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(
    configPath,
    JSON.stringify(config, null, 2) + '\n',
    { mode: 0o644 },
  );
}

/**
 * Check whether an MDM org config exists.
 */
export function hasMdmConfig(): boolean {
  return loadMdmConfig() !== null;
}
