#!/usr/bin/env node --experimental-strip-types
/**
 * Archive Creation Script
 *
 * Creates a platform-specific .tar.gz archive from pre-built SEA binaries.
 * Used after the binaries have already been built and injected.
 *
 * Usage:
 *   node --experimental-strip-types tools/sea/package.mts [--platform PLATFORM] [--arch ARCH]
 */

import * as os from 'node:os';
import * as path from 'node:path';
import { DIST_SEA } from './shared/constants.mts';
import { createArchive } from './shared/build-helpers.mts';

const argv = process.argv.slice(2);

function getArg(name: string): string | undefined {
  const idx = argv.indexOf(name);
  return idx >= 0 ? argv[idx + 1] : undefined;
}

const platform = getArg('--platform') || os.platform();
const arch = getArg('--arch') || os.arch();
const isWin = platform === 'win32';

const APPS = [
  { name: isWin ? 'agenshield.exe' : 'agenshield', app: 'cli-bin' },
  { name: isWin ? 'agenshield-daemon.exe' : 'agenshield-daemon', app: 'daemon-bin' },
  { name: isWin ? 'agenshield-broker.exe' : 'agenshield-broker', app: 'broker-bin' },
];

createArchive({
  binaries: APPS.map(a => ({
    name: a.name,
    path: path.join(DIST_SEA, 'apps', a.app, a.name),
  })),
  platform,
  arch,
});
