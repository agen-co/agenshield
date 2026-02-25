/**
 * Cloud client utilities (CLI-specific)
 *
 * Handles the OAuth2 device code flow for connecting a local AgenShield
 * installation to AgenShield Cloud for centralized policy management.
 *
 * Core auth primitives (Ed25519, AgentSig, credentials) live in @agenshield/auth.
 * This module adds CLI-specific orchestration: device code flow, polling, and registration.
 */

import * as os from 'node:os';
import { getVersion } from './version.js';
import {
  CLOUD_CONFIG,
  generateEd25519Keypair,
  createAgentSigHeader,
  saveCloudCredentials,
  loadCloudCredentials,
  isCloudEnrolled,
} from '@agenshield/auth';
import type {
  Ed25519Keypair,
  CloudCredentials,
} from '@agenshield/auth';

// Re-export auth primitives so setup.ts has a single import source
export {
  CLOUD_CONFIG,
  generateEd25519Keypair,
  createAgentSigHeader,
  saveCloudCredentials,
  loadCloudCredentials,
  isCloudEnrolled,
};
export type {
  Ed25519Keypair,
  CloudCredentials,
};

// ---------------------------------------------------------------------------
// Types (CLI-specific)
// ---------------------------------------------------------------------------

export interface DeviceCodeResponse {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  expiresIn: number;
  interval: number;
}

export interface DeviceCodePollResult {
  status: 'authorization_pending' | 'approved' | 'expired' | 'denied';
  enrollmentToken?: string;
  companyName?: string;
  error?: string;
}

export interface DeviceRegistrationResult {
  agentId: string;
  agentKey: string;
}

// ---------------------------------------------------------------------------
// Device code flow
// ---------------------------------------------------------------------------

/**
 * Initiate the device code flow with AgenShield Cloud.
 * Returns codes for the user to authorize in their browser.
 */
export async function initiateDeviceCode(cloudUrl?: string): Promise<DeviceCodeResponse> {
  const baseUrl = cloudUrl ?? CLOUD_CONFIG.url;

  const res = await fetch(`${baseUrl}/api/agents/device-code`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Failed to initiate device code flow: ${res.status} ${body}`);
  }

  return (await res.json()) as DeviceCodeResponse;
}

/**
 * Poll the cloud for device code authorization status.
 * Resolves when the user approves (or the code expires/is denied).
 */
export async function pollDeviceCode(
  cloudUrl: string | undefined,
  deviceCode: string,
  interval: number,
  timeoutMs = 15 * 60 * 1000,
): Promise<DeviceCodePollResult> {
  const baseUrl = cloudUrl ?? CLOUD_CONFIG.url;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, interval * 1000));

    const res = await fetch(`${baseUrl}/api/agents/device-code/poll`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceCode }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Poll failed: ${res.status} ${body}`);
    }

    const result = (await res.json()) as DeviceCodePollResult;

    if (result.status !== 'authorization_pending') {
      return result;
    }
  }

  return { status: 'expired', error: 'Device code polling timed out' };
}

// ---------------------------------------------------------------------------
// Device registration
// ---------------------------------------------------------------------------

/**
 * Register this device with AgenShield Cloud using an enrollment token.
 * Sends the Ed25519 public key for future AgentSig authentication.
 */
export async function registerDevice(
  cloudUrl: string | undefined,
  enrollmentToken: string,
  publicKey: string,
  hostname: string,
): Promise<DeviceRegistrationResult> {
  const baseUrl = cloudUrl ?? CLOUD_CONFIG.url;

  const res = await fetch(`${baseUrl}/api/agents/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      enrollmentToken,
      publicKey,
      hostname,
      osVersion: `${os.type()} ${os.release()}`,
      agentVersion: getVersion(),
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Device registration failed: ${res.status} ${body}`);
  }

  const data = (await res.json()) as { agent: { id: string }; agentKey: { id: string } };
  return {
    agentId: data.agent.id,
    agentKey: data.agentKey.id,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
