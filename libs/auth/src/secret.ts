/**
 * JWT Secret Manager
 *
 * Generates, persists, and loads the HMAC-SHA256 secret used for signing JWTs.
 * The secret is stored at /var/run/agenshield/.jwt-secret with mode 0o600.
 */

import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

/** Default secret file location */
const DEFAULT_SECRET_DIR = '/var/run/agenshield';
const DEFAULT_SECRET_FILENAME = '.jwt-secret';

/** Secret size in bytes (256-bit) */
const SECRET_SIZE = 32;

/** Cached secret instance */
let cachedSecret: Uint8Array | null = null;

/**
 * Get the path to the JWT secret file
 */
export function getSecretPath(
  secretDir = DEFAULT_SECRET_DIR,
  secretFilename = DEFAULT_SECRET_FILENAME,
): string {
  return path.join(secretDir, secretFilename);
}

/**
 * Generate a new random 256-bit secret
 */
export function generateSecret(): Uint8Array {
  return new Uint8Array(crypto.randomBytes(SECRET_SIZE));
}

/**
 * Load or generate the JWT secret.
 *
 * - If the secret file exists, reads and caches it.
 * - If not, generates a new secret, writes it to disk (mode 0o600), and caches it.
 *
 * @param secretDir Directory for the secret file
 * @param secretFilename Name of the secret file
 * @returns The JWT signing secret
 */
export function loadOrCreateSecret(
  secretDir = DEFAULT_SECRET_DIR,
  secretFilename = DEFAULT_SECRET_FILENAME,
): Uint8Array {
  if (cachedSecret) {
    return cachedSecret;
  }

  const filePath = getSecretPath(secretDir, secretFilename);

  if (fs.existsSync(filePath)) {
    const raw = fs.readFileSync(filePath);
    cachedSecret = new Uint8Array(raw);
    return cachedSecret;
  }

  // Generate new secret
  const secret = generateSecret();

  // Ensure directory exists
  if (!fs.existsSync(secretDir)) {
    fs.mkdirSync(secretDir, { recursive: true, mode: 0o700 });
  }

  // Write secret file (owner-only)
  fs.writeFileSync(filePath, Buffer.from(secret), { mode: 0o600 });

  cachedSecret = secret;
  return cachedSecret;
}

/**
 * Get the cached secret. Throws if not yet loaded.
 */
export function getSecret(): Uint8Array {
  if (!cachedSecret) {
    throw new Error('JWT secret not initialized. Call loadOrCreateSecret() first.');
  }
  return cachedSecret;
}

/**
 * Clear the cached secret (for testing or shutdown)
 */
export function clearSecretCache(): void {
  if (cachedSecret) {
    // Zero out the buffer for security
    cachedSecret.fill(0);
  }
  cachedSecret = null;
}
