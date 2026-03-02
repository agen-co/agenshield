/**
 * Cloud client utilities (CLI-specific)
 *
 * Thin wrappers around @agenshield/auth cloud functions.
 * The CLI wrapper for registerDevice passes getVersion() as agentVersion.
 *
 * Core auth primitives (Ed25519, AgentSig, credentials) live in @agenshield/auth.
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
  initiateDeviceCode as authInitiateDeviceCode,
  pollDeviceCode as authPollDeviceCode,
  registerDevice as authRegisterDevice,
} from '@agenshield/auth';
import type {
  Ed25519Keypair,
  CloudCredentials,
  DeviceCodeResponse,
  DeviceCodePollResult,
  DeviceRegistrationResult,
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
  DeviceCodeResponse,
  DeviceCodePollResult,
  DeviceRegistrationResult,
};

// ---------------------------------------------------------------------------
// Device code flow (delegates to @agenshield/auth)
// ---------------------------------------------------------------------------

/**
 * Initiate the device code flow with AgenShield Cloud.
 * Returns codes for the user to authorize in their browser.
 */
export async function initiateDeviceCode(cloudUrl?: string): Promise<DeviceCodeResponse> {
  return authInitiateDeviceCode(cloudUrl);
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
  return authPollDeviceCode(cloudUrl, deviceCode, interval, timeoutMs);
}

// ---------------------------------------------------------------------------
// Device registration (delegates to @agenshield/auth with CLI version)
// ---------------------------------------------------------------------------

/**
 * Register this device with AgenShield Cloud using an enrollment token.
 * Sends the Ed25519 public key for future AgentSig authentication.
 *
 * This CLI wrapper automatically provides the agent version from package.json.
 */
export async function registerDevice(
  cloudUrl: string | undefined,
  enrollmentToken: string,
  publicKey: string,
  hostname: string,
): Promise<DeviceRegistrationResult> {
  return authRegisterDevice(cloudUrl, enrollmentToken, publicKey, hostname, getVersion());
}
