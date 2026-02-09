/**
 * REST API routes for the update server
 *
 * Wraps the UpdateEngine with HTTP endpoints and streams
 * state changes as SSE events.
 */

import type { FastifyInstance } from 'fastify';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { VAULT_FILE } from '@agenshield/ipc';
import type { UpdateEngine } from '../update/engine.js';
import { broadcastUpdateEvent } from './sse.js';

/** Race guard — prevent double-triggering */
let isRunning = false;

/**
 * Verify passcode against the vault file directly (daemon-independent).
 * Reads vault.enc, decrypts it, and checks the PBKDF2 hash.
 */
async function verifyPasscodeDirect(passcode: string): Promise<boolean> {
  try {
    // Import vault crypto utilities from daemon package
    const { getMachineId, deriveKey, decrypt } = await import('@agenshield/daemon/vault');
    const configDir = path.join(os.homedir(), '.agenshield');
    const vaultPath = path.join(configDir, VAULT_FILE);

    if (!fs.existsSync(vaultPath)) {
      // No vault = no passcode set, allow through
      return true;
    }

    const encrypted = fs.readFileSync(vaultPath, 'utf-8');
    const machineId = getMachineId();
    const key = deriveKey(machineId);
    const decrypted = decrypt(encrypted, key);
    const contents = JSON.parse(decrypted);

    if (!contents.passcode?.hash) {
      // No passcode set in vault
      return true;
    }

    // Verify PBKDF2 hash
    const storedHash = contents.passcode.hash as string;
    const parts = storedHash.split(':');
    if (parts.length !== 3) return false;

    const iterations = parseInt(parts[0], 10);
    const salt = Buffer.from(parts[1], 'base64');
    const hash = Buffer.from(parts[2], 'base64');

    return new Promise<boolean>((resolve, reject) => {
      crypto.pbkdf2(passcode, salt, iterations, hash.length, 'sha512', (err, derivedKey) => {
        if (err) { reject(err); return; }
        resolve(crypto.timingSafeEqual(hash, derivedKey));
      });
    });
  } catch (err) {
    console.error('Passcode verification error:', (err as Error).message);
    // If vault can't be read (e.g., different machine), fall back to allowing
    // The user still needed sudo to get here
    return false;
  }
}

/**
 * Register all update API routes
 */
export async function registerRoutes(app: FastifyInstance, engine: UpdateEngine): Promise<void> {
  // --- Health ---
  app.get('/api/health', async () => {
    return {
      success: true,
      data: {
        ok: true,
        timestamp: new Date().toISOString(),
        mode: 'update' as const,
      },
    };
  });

  // --- Auth status (for UI gating) ---
  app.get('/api/auth/status', async () => {
    return {
      protectionEnabled: false,
      passcodeSet: false,
      allowAnonymousReadOnly: true,
      lockedOut: false,
    };
  });

  // --- Update state ---
  app.get('/api/update/state', async () => {
    return {
      success: true,
      data: {
        state: engine.state,
        releaseNotes: engine.state.releaseNotes,
        authRequired: engine.state.authRequired,
        authenticated: engine.state.authenticated,
      },
    };
  });

  // --- Authenticate (verify passcode) ---
  app.post<{ Body: { passcode: string } }>(
    '/api/update/authenticate',
    async (request) => {
      const { passcode } = request.body;

      if (!passcode) {
        return {
          success: false,
          error: { code: 'MISSING_PASSCODE', message: 'Passcode is required' },
        };
      }

      const valid = await verifyPasscodeDirect(passcode);
      if (!valid) {
        return {
          success: false,
          error: { code: 'INVALID_PASSCODE', message: 'Invalid passcode' },
        };
      }

      engine.setAuthenticated();
      broadcastUpdateEvent('update:state', { state: engine.state });

      return { success: true, data: { authenticated: true } };
    },
  );

  // --- Release notes ---
  app.get('/api/update/release-notes', async () => {
    return {
      success: true,
      data: { releaseNotes: engine.state.releaseNotes },
    };
  });

  // --- Confirm and start update ---
  app.post('/api/update/confirm', async () => {
    if (isRunning) {
      return {
        success: false,
        error: { code: 'ALREADY_RUNNING', message: 'Update is already in progress' },
      };
    }

    if (engine.state.authRequired && !engine.state.authenticated) {
      return {
        success: false,
        error: { code: 'NOT_AUTHENTICATED', message: 'Passcode verification required' },
      };
    }

    isRunning = true;

    // Run update asynchronously — progress streams via SSE
    engine.execute().then(() => {
      isRunning = false;
      if (engine.state.hasError) {
        broadcastUpdateEvent('update:error', { state: engine.state });
      } else {
        broadcastUpdateEvent('update:complete', { state: engine.state });
      }
    }).catch((err) => {
      isRunning = false;
      broadcastUpdateEvent('update:error', {
        error: (err as Error).message,
        state: engine.state,
      });
    });

    return { success: true, data: { started: true } };
  });
}
