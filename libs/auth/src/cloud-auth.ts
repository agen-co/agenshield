/**
 * Cloud authentication primitives
 *
 * Centralizes Ed25519 agent key management, AgentSig header creation,
 * and cloud credential storage for the AgenShield-to-Cloud connection.
 *
 * Used by both the CLI (setup cloud) and the daemon (cloud-connector).
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { generateKeyPairSync, sign, verify } from 'node:crypto';

// ---------------------------------------------------------------------------
// Cloud configuration
// ---------------------------------------------------------------------------

const DEFAULT_CLOUD_URL = 'http://localhost:9090';

export const CLOUD_CONFIG = {
  /** Cloud API base URL (override via AGENSHIELD_CLOUD_URL env var) */
  get url(): string {
    return process.env['AGENSHIELD_CLOUD_URL'] || DEFAULT_CLOUD_URL;
  },
  /** Path to local cloud credentials */
  credentialsPath: path.join(os.homedir(), '.agenshield', 'cloud.json'),
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Ed25519Keypair {
  publicKey: string;
  privateKey: string;
}

export interface CloudCredentials {
  agentId: string;
  privateKey: string;
  cloudUrl: string;
  companyName: string;
  registeredAt: string;
}

/**
 * Result of parsing an AgentSig authorization header.
 */
export interface AgentSigParts {
  agentId: string;
  timestamp: number;
  signature: Buffer;
}

// ---------------------------------------------------------------------------
// Ed25519 keypair management
// ---------------------------------------------------------------------------

/**
 * Generate an Ed25519 keypair for agent-to-cloud authentication.
 * Public key is PEM-encoded SPKI, private key is PEM-encoded PKCS8.
 */
export function generateEd25519Keypair(): Ed25519Keypair {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519', {
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });

  return { publicKey, privateKey };
}

// ---------------------------------------------------------------------------
// AgentSig authentication
// ---------------------------------------------------------------------------

/** Maximum allowed clock skew for AgentSig timestamps (5 minutes). */
const AGENT_SIG_MAX_SKEW_MS = 5 * 60 * 1000;

/**
 * Create an AgentSig authorization header value.
 *
 * Format: `AgentSig {agentId}:{timestamp}:{base64Signature}`
 *
 * The signature is computed as: Ed25519_sign("{agentId}:{timestamp}")
 * This matches the verification in agenshield-cloud's ConnectionsGateway.
 */
export function createAgentSigHeader(agentId: string, privateKey: string): string {
  const timestamp = Date.now().toString();
  const data = Buffer.from(`${agentId}:${timestamp}`);
  const signature = sign(null, data, privateKey);
  return `AgentSig ${agentId}:${timestamp}:${signature.toString('base64')}`;
}

/**
 * Parse an AgentSig authorization header.
 * Returns null if the header is missing or malformed.
 */
export function parseAgentSigHeader(authHeader: string): AgentSigParts | null {
  if (!authHeader.startsWith('AgentSig ')) return null;

  const payload = authHeader.slice('AgentSig '.length);
  const [agentId, timestampStr, signatureB64] = payload.split(':');
  if (!agentId || !timestampStr || !signatureB64) return null;

  const timestamp = parseInt(timestampStr, 10);
  if (isNaN(timestamp)) return null;

  return {
    agentId,
    timestamp,
    signature: Buffer.from(signatureB64, 'base64'),
  };
}

/**
 * Verify an AgentSig authorization header against a known public key.
 *
 * Checks:
 *   1. Header is well-formed
 *   2. Timestamp is within ±5 minutes (prevents replay attacks)
 *   3. Ed25519 signature is valid for the claimed agentId:timestamp
 *
 * @returns The agentId if valid, null otherwise.
 */
export function verifyAgentSig(
  authHeader: string,
  publicKey: string,
): string | null {
  const parts = parseAgentSigHeader(authHeader);
  if (!parts) return null;

  // Reject stale timestamps
  if (Math.abs(Date.now() - parts.timestamp) > AGENT_SIG_MAX_SKEW_MS) return null;

  // Verify Ed25519 signature
  const data = Buffer.from(`${parts.agentId}:${parts.timestamp}`);
  const isValid = verify('Ed25519', data, publicKey, parts.signature);

  return isValid ? parts.agentId : null;
}

// ---------------------------------------------------------------------------
// Cloud credential storage
// ---------------------------------------------------------------------------

/**
 * Save cloud credentials to ~/.agenshield/cloud.json (mode 0o600).
 */
export function saveCloudCredentials(
  agentId: string,
  privateKey: string,
  cloudUrl: string,
  companyName: string,
): void {
  const credentials: CloudCredentials = {
    agentId,
    privateKey,
    cloudUrl,
    companyName,
    registeredAt: new Date().toISOString(),
  };

  const dir = path.dirname(CLOUD_CONFIG.credentialsPath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    CLOUD_CONFIG.credentialsPath,
    JSON.stringify(credentials, null, 2) + '\n',
    { mode: 0o600 },
  );
}

/**
 * Load cloud credentials from ~/.agenshield/cloud.json.
 * Returns null if not enrolled.
 */
export function loadCloudCredentials(): CloudCredentials | null {
  try {
    const raw = fs.readFileSync(CLOUD_CONFIG.credentialsPath, 'utf-8');
    const data = JSON.parse(raw) as CloudCredentials;
    if (!data.agentId || !data.privateKey) return null;
    return data;
  } catch {
    return null;
  }
}

/**
 * Check whether this device is enrolled in AgenShield Cloud.
 */
export function isCloudEnrolled(): boolean {
  return loadCloudCredentials() !== null;
}
