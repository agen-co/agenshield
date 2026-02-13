#!/usr/bin/env node
/**
 * AgenShield Daemon Entry Point
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { initStorage, DB_FILENAME, ACTIVITY_DB_FILENAME } from '@agenshield/storage';
import { loadConfig, ensureConfigDir, getConfigDir, getPidPath } from './config/index';
import { startServer } from './server';

async function main(): Promise<void> {
  // Ensure config directory exists
  ensureConfigDir();

  // Initialize storage before loadConfig (config reads from DB)
  const configDir = getConfigDir();
  const dbPath = path.join(configDir, DB_FILENAME);
  const activityDbPath = path.join(configDir, ACTIVITY_DB_FILENAME);
  initStorage(dbPath, activityDbPath);

  // Load configuration
  const config = loadConfig();

  // Write PID file
  const pidPath = getPidPath();
  fs.writeFileSync(pidPath, process.pid.toString(), 'utf-8');

  // Handle shutdown gracefully
  const cleanup = () => {
    if (fs.existsSync(pidPath)) {
      fs.unlinkSync(pidPath);
    }
    process.exit(0);
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  // Start server
  try {
    const server = await startServer(config.daemon);
    console.log(`AgenShield daemon started on http://${config.daemon.host}:${config.daemon.port}`);
  } catch (error) {
    console.error('Failed to start daemon:', error);
    cleanup();
    process.exit(1);
  }
}

main();
