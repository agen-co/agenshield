/**
 * Cloud configuration
 *
 * Centralizes cloud URL and credentials path resolution.
 */

import * as os from 'node:os';
import * as path from 'node:path';

const DEFAULT_CLOUD_URL = 'http://localhost:9090';

export const CLOUD_CONFIG = {
  /** Cloud API base URL (override via AGENSHIELD_CLOUD_URL env var) */
  get url(): string {
    return process.env['AGENSHIELD_CLOUD_URL'] || DEFAULT_CLOUD_URL;
  },
  /** Path to local cloud credentials */
  get credentialsPath(): string {
    const home = process.env['AGENSHIELD_USER_HOME'] || process.env['HOME'] || os.homedir();
    return path.join(home, '.agenshield', 'cloud.json');
  },
};
