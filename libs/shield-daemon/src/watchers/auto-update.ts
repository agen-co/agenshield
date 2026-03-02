/**
 * Auto-Update Watcher
 *
 * Periodically checks GitHub Releases for newer AgenShield versions
 * and emits a `system:update-available` SSE event when one is found.
 *
 * This is a notification-only watcher — it does NOT auto-install updates.
 * The user must run `agenshield upgrade` from the CLI to apply updates,
 * since upgrades require sudo access and a daemon restart.
 *
 * Default check interval: every 6 hours. Configurable.
 */

import * as https from 'node:https';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { emitUpdateAvailable } from '../events/emitter';
import { getLogger } from '../logger';

const DEFAULT_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours
const DEFAULT_GITHUB_REPO = 'agen-co/agenshield';

let watcherInterval: NodeJS.Timeout | null = null;
let lastNotifiedVersion: string | null = null;

/**
 * Read the current version from ~/.agenshield/version.json.
 */
function readCurrentVersion(): string | null {
  try {
    const versionPath = path.join(os.homedir(), '.agenshield', 'version.json');
    const raw = fs.readFileSync(versionPath, 'utf-8');
    const data = JSON.parse(raw);
    return typeof data.version === 'string' ? data.version : null;
  } catch {
    return null;
  }
}

/**
 * Query GitHub Releases API for the latest version tag.
 * Lightweight HTTP-only implementation — no external dependencies.
 */
function queryLatestVersion(repo: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = `https://api.github.com/repos/${repo}/releases/latest`;
    const req = https.get(url, {
      headers: {
        'User-Agent': 'agenshield-daemon',
        'Accept': 'application/vnd.github+json',
      },
      timeout: 15_000,
    }, (res) => {
      // Follow one redirect
      if ((res.statusCode === 301 || res.statusCode === 302) && res.headers['location']) {
        https.get(res.headers['location'], {
          headers: { 'User-Agent': 'agenshield-daemon', 'Accept': 'application/vnd.github+json' },
          timeout: 15_000,
        }, (r2) => {
          let body = '';
          r2.on('data', (chunk: Buffer) => { body += chunk; });
          r2.on('end', () => {
            try {
              const data = JSON.parse(body);
              resolve(((data.tag_name as string) ?? '').replace(/^v/, ''));
            } catch (e) { reject(e); }
          });
        }).on('error', reject);
        return;
      }

      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`GitHub API returned ${res.statusCode}`));
        return;
      }

      let body = '';
      res.on('data', (chunk: Buffer) => { body += chunk; });
      res.on('end', () => {
        try {
          const data = JSON.parse(body);
          resolve(((data.tag_name as string) ?? '').replace(/^v/, ''));
        } catch (e) { reject(e); }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('GitHub API request timed out'));
    });
  });
}

/**
 * Compare two semver strings. Returns true if `latest` is newer than `current`.
 */
function isNewerVersion(current: string, latest: string): boolean {
  const parseSemver = (v: string) => v.split('.').map((n) => parseInt(n, 10) || 0);
  const c = parseSemver(current);
  const l = parseSemver(latest);
  for (let i = 0; i < Math.max(c.length, l.length); i++) {
    const cv = c[i] ?? 0;
    const lv = l[i] ?? 0;
    if (lv > cv) return true;
    if (lv < cv) return false;
  }
  return false;
}

/**
 * Perform a single update check.
 */
async function checkForUpdate(repo: string): Promise<void> {
  const log = getLogger();

  try {
    const currentVersion = readCurrentVersion();
    if (!currentVersion) {
      log.debug('[auto-update] No version.json found, skipping update check');
      return;
    }

    const latestVersion = await queryLatestVersion(repo);
    if (!latestVersion) {
      log.debug('[auto-update] Could not determine latest version');
      return;
    }

    if (isNewerVersion(currentVersion, latestVersion) && latestVersion !== lastNotifiedVersion) {
      lastNotifiedVersion = latestVersion;
      const releaseUrl = `https://github.com/${repo}/releases/tag/v${latestVersion}`;

      log.info(
        { currentVersion, latestVersion, releaseUrl },
        '[auto-update] Newer version available',
      );

      emitUpdateAvailable({
        currentVersion,
        latestVersion,
        releaseUrl,
      });
    } else {
      log.debug(
        { currentVersion, latestVersion },
        '[auto-update] No newer version available',
      );
    }
  } catch (err) {
    log.debug({ err }, '[auto-update] Update check failed');
  }
}

/**
 * Start the periodic auto-update checker.
 *
 * @param intervalMs - Check interval (default: 6 hours)
 * @param repo - GitHub repository (default: agen-co/agenshield)
 */
export function startAutoUpdateWatcher(
  intervalMs = DEFAULT_CHECK_INTERVAL_MS,
  repo = DEFAULT_GITHUB_REPO,
): void {
  if (watcherInterval) return; // Already running

  const log = getLogger();

  // Delay the first check by 30 seconds to let the daemon stabilize at boot
  setTimeout(() => {
    checkForUpdate(repo);
  }, 30_000);

  watcherInterval = setInterval(() => {
    checkForUpdate(repo);
  }, intervalMs);

  log.info(`Auto-update watcher started (interval: ${intervalMs}ms)`);
}

/**
 * Stop the auto-update watcher.
 */
export function stopAutoUpdateWatcher(): void {
  if (watcherInterval) {
    clearInterval(watcherInterval);
    watcherInterval = null;
    lastNotifiedVersion = null;
    getLogger().info('Auto-update watcher stopped');
  }
}
