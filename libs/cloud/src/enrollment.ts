/**
 * EnrollmentProtocol — enrollment state machine
 *
 * Handles the device code flow orchestration: detects MDM config,
 * initiates device code flow, polls for user approval, registers the device,
 * and saves credentials. Daemon-specific actions (event emission, setup
 * finalization) are delegated to callbacks.
 */

import * as os from 'node:os';
import { isCloudEnrolled, saveCloudCredentials } from './credentials';
import { loadMdmConfig } from './mdm-config';
import { generateEd25519Keypair } from './auth';
import { initiateDeviceCode, pollDeviceCode, registerDevice } from './device-code';
import { CloudEnrollmentError } from './errors';
import type { EnrollmentState, EnrollmentCallbacks, CloudLogger } from './types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_RETRIES = 5;
const RETRY_DELAY_MS = 60_000;

// ---------------------------------------------------------------------------
// Noop logger
// ---------------------------------------------------------------------------

const noopLogger: CloudLogger = {
  info() { /* noop */ },
  warn() { /* noop */ },
  error() { /* noop */ },
  debug() { /* noop */ },
};

// ---------------------------------------------------------------------------
// EnrollmentProtocol
// ---------------------------------------------------------------------------

export class EnrollmentProtocol {
  private currentState: EnrollmentState = { state: 'idle' };
  private retryTimer: NodeJS.Timeout | null = null;
  private stopped = false;
  private retryCount = 0;
  private callbacks: EnrollmentCallbacks;
  private logger: CloudLogger;

  constructor(callbacks: EnrollmentCallbacks, logger?: CloudLogger) {
    this.callbacks = callbacks;
    this.logger = logger ?? noopLogger;
  }

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

    this.logger.info('[enrollment] MDM config detected, starting device code enrollment...');

    await this.runEnrollment(mdmConfig.cloudUrl, mdmConfig.orgClientId);
  }

  /**
   * Start cloud enrollment from an HTTP request (setup API).
   * Unlike checkAndEnroll(), this does not require MDM config — it takes cloudUrl directly.
   */
  async startCloudEnrollment(cloudUrl: string): Promise<void> {
    if (this.currentState.state !== 'idle' && this.currentState.state !== 'failed') {
      throw new Error(`Enrollment already in progress (state: ${this.currentState.state})`);
    }
    this.stopped = false;
    this.retryCount = 0;
    await this.runEnrollment(cloudUrl);
  }

  /**
   * Stop the enrollment protocol and clean up timers.
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

  private async runEnrollment(cloudUrl: string, orgClientId?: string): Promise<void> {
    if (this.stopped) return;

    try {
      // 1. Initiate device code flow
      this.setState({ state: 'initiating' });

      const deviceCode = await initiateDeviceCode(cloudUrl, orgClientId);

      if (this.stopped) return;

      // 2. Set pending state and notify via callback
      const expiresAt = new Date(Date.now() + deviceCode.expiresIn * 1000).toISOString();
      this.setState({
        state: 'pending_user_auth',
        verificationUri: deviceCode.verificationUri,
        userCode: deviceCode.userCode,
        expiresAt,
      });

      this.callbacks.onPending({
        verificationUri: deviceCode.verificationUri,
        userCode: deviceCode.userCode,
        expiresAt,
      });

      this.logger.info(`[enrollment] Waiting for user auth — code: ${deviceCode.userCode}, url: ${deviceCode.verificationUri}`);

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

      this.logger.info(`[enrollment] User authorized by ${pollResult.companyName || 'organization'}`);

      // 4. Generate keypair and register
      this.setState({ state: 'registering' });

      if (!pollResult.enrollmentToken) {
        throw new CloudEnrollmentError('Approved response missing enrollment token');
      }

      const keypair = generateEd25519Keypair();
      const registration = await registerDevice(
        cloudUrl,
        pollResult.enrollmentToken,
        keypair.publicKey,
        os.hostname(),
        this.callbacks.getAgentVersion(),
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

      this.callbacks.onComplete({
        agentId: registration.agentId,
        companyName,
      });

      this.logger.info(`[enrollment] Device registered (ID: ${registration.agentId}, company: ${companyName})`);

      // 7. Notify caller for post-enrollment actions
      await this.callbacks.onEnrolled({
        agentId: registration.agentId,
        companyName,
        cloudUrl,
      });

      this.retryCount = 0;
    } catch (err) {
      if (this.stopped) return;

      const errorMessage = (err as Error).message;
      this.logger.error(`[enrollment] Enrollment failed: ${errorMessage}`);

      this.retryCount++;
      if (this.retryCount < MAX_RETRIES) {
        const retryAt = new Date(Date.now() + RETRY_DELAY_MS).toISOString();
        this.setState({ state: 'failed', error: errorMessage, retryAt });

        this.callbacks.onFailed({ error: errorMessage, retryAt });

        this.logger.info(`[enrollment] Retrying in ${RETRY_DELAY_MS / 1000}s (attempt ${this.retryCount}/${MAX_RETRIES})`);

        this.retryTimer = setTimeout(() => {
          this.retryTimer = null;
          if (!this.stopped) {
            this.runEnrollment(cloudUrl, orgClientId);
          }
        }, RETRY_DELAY_MS);
      } else {
        this.setState({ state: 'failed', error: errorMessage });

        this.callbacks.onFailed({ error: errorMessage });

        this.logger.error(`[enrollment] Max retries (${MAX_RETRIES}) exceeded — enrollment abandoned`);
      }
    }
  }
}
