/**
 * JWT signing functions
 *
 * Creates signed JWTs for admin (Shield-UI) and broker (shielded apps) roles.
 */

import { SignJWT } from 'jose';
import { getSecret } from './secret';
import type { AdminPayload, BrokerPayload } from './types';

/** Admin token TTL: 30 minutes */
const ADMIN_TTL_SECONDS = 30 * 60;

/**
 * Sign an admin JWT for Shield-UI / CLI access.
 *
 * @returns Signed JWT string
 */
export async function signAdminToken(): Promise<string> {
  const secret = getSecret();
  const now = Math.floor(Date.now() / 1000);

  const jwt = await new SignJWT({
    role: 'admin',
  } satisfies Omit<AdminPayload, 'sub' | 'iat' | 'exp'>)
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject('shield-ui')
    .setIssuedAt(now)
    .setExpirationTime(now + ADMIN_TTL_SECONDS)
    .sign(secret);

  return jwt;
}

/**
 * Sign a broker JWT for a shielded app (target profile).
 * Broker tokens have no expiration.
 *
 * @param profileId The profile ID to embed as `sub`
 * @param targetId The target ID for scoping
 * @returns Signed JWT string
 */
export async function signBrokerToken(profileId: string, targetId: string): Promise<string> {
  const secret = getSecret();
  const now = Math.floor(Date.now() / 1000);

  const jwt = await new SignJWT({
    role: 'broker',
    targetId,
  } satisfies Omit<BrokerPayload, 'sub' | 'iat'>)
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(profileId)
    .setIssuedAt(now)
    // No expiration for broker tokens
    .sign(secret);

  return jwt;
}

/**
 * Get the admin token TTL in seconds
 */
export function getAdminTtlSeconds(): number {
  return ADMIN_TTL_SECONDS;
}
