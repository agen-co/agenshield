/**
 * Config integrity verification via HMAC-SHA256.
 *
 * The HMAC key is derived from the machine ID (same source as vault encryption)
 * using a separate HKDF-like derivation with a distinct label so that
 * compromising one key doesn't compromise the other.
 */

import * as crypto from 'node:crypto';
import type { PolicyConfig } from '@agenshield/ipc';
import { getMachineId, deriveKey } from '../vault/crypto';

const INTEGRITY_LABEL = 'agenshield-config-integrity-v1';

/** Cached integrity key (derived once per process). */
let cachedKey: Buffer | null = null;

function getIntegrityKey(): Buffer {
  if (cachedKey) return cachedKey;
  const machineId = getMachineId();
  // Derive a separate 32-byte key using the integrity label as salt
  cachedKey = deriveKey(machineId + INTEGRITY_LABEL);
  return cachedKey;
}

/**
 * Compute HMAC-SHA256 over the canonical JSON representation of policies.
 * Policies are sorted by ID for determinism.
 */
export function computeConfigHmac(policies: PolicyConfig[]): string {
  const key = getIntegrityKey();
  const sorted = [...policies].sort((a, b) => a.id.localeCompare(b.id));
  const canonical = JSON.stringify(sorted);
  return crypto.createHmac('sha256', key).update(canonical).digest('hex');
}

/**
 * Verify that an HMAC matches the computed value for the given policies.
 * Uses timing-safe comparison to prevent timing attacks.
 */
export function verifyConfigHmac(policies: PolicyConfig[], expectedHmac: string): boolean {
  const actual = computeConfigHmac(policies);
  if (actual.length !== expectedHmac.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(expectedHmac, 'hex'));
  } catch {
    return false;
  }
}

/**
 * Reset the cached integrity key (for testing).
 */
export function resetIntegrityKeyCache(): void {
  cachedKey = null;
}
