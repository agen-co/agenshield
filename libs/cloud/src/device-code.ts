/**
 * Device code flow
 *
 * OAuth2 device code flow for enrolling agents with AgenShield Cloud.
 */

import * as os from 'node:os';
import { CLOUD_CONFIG } from './config';
import type {
  DeviceCodeResponse,
  DeviceCodePollResult,
  DeviceRegistrationResult,
} from './types';

/**
 * Initiate the device code flow with AgenShield Cloud.
 * Returns codes for the user to authorize in their browser.
 *
 * @param cloudUrl - Override cloud URL (defaults to CLOUD_CONFIG.url)
 * @param orgClientId - Optional org client ID for MDM enrollment
 */
export async function initiateDeviceCode(
  cloudUrl?: string,
  orgClientId?: string,
): Promise<DeviceCodeResponse> {
  const baseUrl = cloudUrl ?? CLOUD_CONFIG.url;

  const body: Record<string, unknown> = {};
  if (orgClientId) {
    body.orgClientId = orgClientId;
  }

  const res = await fetch(`${baseUrl}/api/agents/device-code`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Failed to initiate device code flow: ${res.status} ${text}`);
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
      const text = await res.text().catch(() => '');
      throw new Error(`Poll failed: ${res.status} ${text}`);
    }

    const result = (await res.json()) as DeviceCodePollResult;

    if (result.status !== 'authorization_pending') {
      return result;
    }
  }

  return { status: 'expired', error: 'Device code polling timed out' };
}

/**
 * Register this device with AgenShield Cloud using an enrollment token.
 * Sends the Ed25519 public key for future AgentSig authentication.
 *
 * @param cloudUrl - Cloud API base URL
 * @param enrollmentToken - Token from device code approval
 * @param publicKey - Ed25519 public key (PEM)
 * @param hostname - Machine hostname
 * @param agentVersion - Version of the agent software
 */
export async function registerDevice(
  cloudUrl: string | undefined,
  enrollmentToken: string,
  publicKey: string,
  hostname: string,
  agentVersion: string,
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
      agentVersion,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Device registration failed: ${res.status} ${text}`);
  }

  const data = (await res.json()) as { agent: { id: string }; agentKey: { id: string }; companyName?: string };
  return {
    agentId: data.agent.id,
    agentKey: data.agentKey.id,
    companyName: data.companyName ?? '',
  };
}
