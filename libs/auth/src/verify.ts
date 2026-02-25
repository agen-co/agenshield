/**
 * JWT verification
 *
 * Verifies JWT signatures and decodes payloads.
 */

import { jwtVerify, errors as joseErrors } from 'jose';
import { getSecret } from './secret';
import type { JwtPayload, VerifyResult, TokenRole } from './types';
import { TokenExpiredError, TokenInvalidError } from './errors';

/**
 * Verify a JWT and return the decoded payload.
 *
 * @param token JWT string to verify
 * @returns VerifyResult with validity and decoded payload
 */
export async function verifyToken(token: string): Promise<VerifyResult> {
  try {
    const secret = getSecret();
    const { payload } = await jwtVerify(token, secret, {
      algorithms: ['HS256'],
    });

    const role = payload.role as TokenRole | undefined;
    if (!role || (role !== 'admin' && role !== 'broker')) {
      return { valid: false, error: 'Missing or invalid role claim' };
    }

    const jwtPayload: JwtPayload = role === 'admin'
      ? {
          sub: payload.sub as 'shield-ui',
          role: 'admin',
          iat: payload.iat!,
          exp: payload.exp!,
        }
      : {
          sub: payload.sub as string,
          role: 'broker',
          targetId: payload.targetId as string,
          iat: payload.iat!,
        };

    return { valid: true, payload: jwtPayload };
  } catch (err) {
    if (err instanceof joseErrors.JWTExpired) {
      return { valid: false, error: 'Token has expired' };
    }
    if (err instanceof joseErrors.JWSSignatureVerificationFailed) {
      return { valid: false, error: 'Invalid token signature' };
    }
    if (err instanceof joseErrors.JWTClaimValidationFailed) {
      return { valid: false, error: `Token claim validation failed: ${(err as Error).message}` };
    }
    return { valid: false, error: `Token verification failed: ${(err as Error).message}` };
  }
}

/**
 * Verify a JWT and return the payload, throwing on failure.
 *
 * @param token JWT string to verify
 * @returns Decoded JwtPayload
 * @throws TokenExpiredError if token has expired
 * @throws TokenInvalidError if token is invalid
 */
export async function verifyTokenOrThrow(token: string): Promise<JwtPayload> {
  const result = await verifyToken(token);
  if (!result.valid || !result.payload) {
    if (result.error?.includes('expired')) {
      throw new TokenExpiredError();
    }
    throw new TokenInvalidError(result.error);
  }
  return result.payload;
}
