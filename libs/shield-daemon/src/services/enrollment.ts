/**
 * Enrollment service
 *
 * Handles MDM org-based enrollment: detects MDM config at boot,
 * initiates the OAuth2 device code flow, polls for user approval,
 * registers the device, and connects to cloud.
 *
 * Singleton pattern — same as CloudConnector.
 */

import * as os from 'node:os';
import {
  isCloudEnrolled,
  loadMdmConfig,
  generateEd25519Keypair,
  initiateDeviceCode,
  pollDeviceCode,
  registerDevice,
  saveCloudCredentials,
} from '@agenshield/auth';
import { getLogger } from '../logger';
import { emitEvent } from '../events/emitter';
import { getCloudConnector } from './cloud-connector';
import { VERSION } from '../config/defaults';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type EnrollmentState =
  | { state: 'idle' }
  | { state: 'initiating' }
  | { state: 'pending_user_auth'; verificationUri: string; userCode: string; expiresAt: string }
  | { state: 'registering' }
  | { state: 'complete'; agentId: string; companyName: string }
  | { state: 'failed'; error: string; retryAt?: string };

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_RETRIES = 5;
const RETRY_DELAY_MS = 60_000;

// ---------------------------------------------------------------------------
// EnrollmentService
// ---------------------------------------------------------------------------

export class EnrollmentService {
  private currentState: EnrollmentState = { state: 'idle' };
  private retryTimer: NodeJS.Timeout | null = null;
  private stopped = false;
  private retryCount = 0;

  /**
   * Get the current enrollment state.
   */
  getState(): EnrollmentState {
    return this.currentState;
  }

  /**
   * Check conditions and start enrollment if needed.
   * Called at daemon boot — runs asynchronously.
   */
  async checkAndEnroll(): Promise<void> {
    // Already enrolled — nothing to do
    if (isCloudEnrolled()) {
      return;
    }

    // No MDM config — nothing to do
    const mdmConfig = loadMdmConfig();
    if (!mdmConfig) {
      return;
    }

    const log = getLogger();
    log.info('[enrollment] MDM config detected, starting device code enrollment...');

    await this.runEnrollment(mdmConfig.cloudUrl, mdmConfig.orgClientId);
  }

  /**
   * Stop the enrollment service and clean up timers.
   */
  stop(): void {
    this.stopped = true;
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
  }

  // ─── Internal ─────────────────────────────────────────────

  private setState(state: EnrollmentState): void {
    this.currentState = state;
  }

  private async runEnrollment(cloudUrl: string, orgClientId: string): Promise<void> {
    if (this.stopped) return;

    const log = getLogger();

    try {
      // 1. Initiate device code flow
      this.setState({ state: 'initiating' });

      const deviceCode = await initiateDeviceCode(cloudUrl, orgClientId);

      if (this.stopped) return;

      // 2. Set pending state and broadcast event
      const expiresAt = new Date(Date.now() + deviceCode.expiresIn * 1000).toISOString();
      this.setState({
        state: 'pending_user_auth',
        verificationUri: deviceCode.verificationUri,
        userCode: deviceCode.userCode,
        expiresAt,
      });

      emitEvent('enrollment:pending', {
        verificationUri: deviceCode.verificationUri,
        userCode: deviceCode.userCode,
        expiresAt,
      });

      log.info(`[enrollment] Waiting for user auth — code: ${deviceCode.userCode}, url: ${deviceCode.verificationUri}`);

      // 3. Poll for authorization
      const pollResult = await pollDeviceCode(
        cloudUrl,
        deviceCode.deviceCode,
        deviceCode.interval,
      );

      if (this.stopped) return;

      if (pollResult.status !== 'approved') {
        throw new Error(`Authorization ${pollResult.status}: ${pollResult.error || 'Device code was not approved'}`);
      }

      log.info(`[enrollment] User authorized by ${pollResult.companyName || 'organization'}`);

      // 4. Generate keypair and register
      this.setState({ state: 'registering' });

      const keypair = generateEd25519Keypair();
      const registration = await registerDevice(
        cloudUrl,
        pollResult.enrollmentToken!,
        keypair.publicKey,
        os.hostname(),
        VERSION,
      );

      if (this.stopped) return;

      // 5. Save credentials
      const companyName = pollResult.companyName || 'Unknown';
      saveCloudCredentials(
        registration.agentId,
        keypair.privateKey,
        cloudUrl,
        companyName,
      );

      // 6. Complete
      this.setState({ state: 'complete', agentId: registration.agentId, companyName });

      emitEvent('enrollment:complete', {
        agentId: registration.agentId,
        companyName,
      });

      log.info(`[enrollment] Device registered (ID: ${registration.agentId}, company: ${companyName})`);

      // 7. Connect to cloud
      this.retryCount = 0;
      getCloudConnector().connect().catch((err) => {
        log.warn({ err }, '[enrollment] Post-enrollment cloud connect failed');
      });

    } catch (err) {
      if (this.stopped) return;

      const errorMessage = (err as Error).message;
      log.error({ err }, '[enrollment] Enrollment failed');

      this.retryCount++;
      if (this.retryCount < MAX_RETRIES) {
        const retryAt = new Date(Date.now() + RETRY_DELAY_MS).toISOString();
        this.setState({ state: 'failed', error: errorMessage, retryAt });

        emitEvent('enrollment:failed', { error: errorMessage, retryAt });

        log.info(`[enrollment] Retrying in ${RETRY_DELAY_MS / 1000}s (attempt ${this.retryCount}/${MAX_RETRIES})`);

        this.retryTimer = setTimeout(() => {
          this.retryTimer = null;
          if (!this.stopped) {
            this.runEnrollment(cloudUrl, orgClientId);
          }
        }, RETRY_DELAY_MS);
      } else {
        this.setState({ state: 'failed', error: errorMessage });

        emitEvent('enrollment:failed', { error: errorMessage });

        log.error(`[enrollment] Max retries (${MAX_RETRIES}) exceeded — enrollment abandoned`);
      }
    }
  }
}

// Singleton
let enrollmentService: EnrollmentService | null = null;

export function getEnrollmentService(): EnrollmentService {
  if (!enrollmentService) {
    enrollmentService = new EnrollmentService();
  }
  return enrollmentService;
}
