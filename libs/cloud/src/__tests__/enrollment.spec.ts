/**
 * Tests for EnrollmentProtocol state machine
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { EnrollmentProtocol } from '../enrollment';
import type { EnrollmentCallbacks } from '../types';

// Get references to the mocked functions
const mockInitiateDeviceCode = jest.fn().mockResolvedValue({
  deviceCode: 'dc-test',
  userCode: 'TEST-1234',
  verificationUri: 'https://cloud.test/verify',
  expiresIn: 900,
  interval: 0.01,
});

const mockPollDeviceCode = jest.fn().mockResolvedValue({
  status: 'approved',
  enrollmentToken: 'et-test',
  companyName: 'TestCo',
});

const mockRegisterDevice = jest.fn().mockResolvedValue({
  agentId: 'agent-test',
  agentKey: 'key-test',
});

// Mock device-code module
jest.mock('../device-code', () => ({
  initiateDeviceCode: (...args: unknown[]) => mockInitiateDeviceCode(...args),
  pollDeviceCode: (...args: unknown[]) => mockPollDeviceCode(...args),
  registerDevice: (...args: unknown[]) => mockRegisterDevice(...args),
}));

// Mock auth
jest.mock('../auth', () => ({
  generateEd25519Keypair: jest.fn(() => ({
    publicKey: 'mock-public-key',
    privateKey: 'mock-private-key',
  })),
}));

describe('EnrollmentProtocol', () => {
  let tmpDir: string;
  const origEnv = { ...process.env };
  let callbacks: EnrollmentCallbacks;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'enrollment-test-'));
    process.env['AGENSHIELD_USER_HOME'] = tmpDir;

    jest.clearAllMocks();
    jest.useRealTimers();

    // Restore default mock implementations
    mockInitiateDeviceCode.mockResolvedValue({
      deviceCode: 'dc-test',
      userCode: 'TEST-1234',
      verificationUri: 'https://cloud.test/verify',
      expiresIn: 900,
      interval: 0.01,
    });

    mockPollDeviceCode.mockResolvedValue({
      status: 'approved',
      enrollmentToken: 'et-test',
      companyName: 'TestCo',
    });

    mockRegisterDevice.mockResolvedValue({
      agentId: 'agent-test',
      agentKey: 'key-test',
    });

    callbacks = {
      onPending: jest.fn(),
      onComplete: jest.fn(),
      onFailed: jest.fn(),
      getAgentVersion: jest.fn(() => '1.0.0'),
      onEnrolled: jest.fn().mockResolvedValue(undefined),
    };
  });

  afterEach(() => {
    process.env = { ...origEnv };
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should start in idle state', () => {
    const protocol = new EnrollmentProtocol(callbacks);
    expect(protocol.getState()).toEqual({ state: 'idle' });
  });

  it('should skip enrollment when already enrolled', async () => {
    // Create credentials file to simulate enrollment
    const dir = path.join(tmpDir, '.agenshield');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'cloud.json'),
      JSON.stringify({ agentId: 'existing', privateKey: 'pk' }),
    );

    const protocol = new EnrollmentProtocol(callbacks);
    await protocol.checkAndEnroll();

    expect(protocol.getState()).toEqual({ state: 'idle' });
    expect(callbacks.onPending).not.toHaveBeenCalled();
  });

  it('should skip enrollment when no MDM config', async () => {
    const protocol = new EnrollmentProtocol(callbacks);
    await protocol.checkAndEnroll();

    expect(protocol.getState()).toEqual({ state: 'idle' });
    expect(callbacks.onPending).not.toHaveBeenCalled();
  });

  it('should complete enrollment flow', async () => {
    const protocol = new EnrollmentProtocol(callbacks);
    await protocol.startCloudEnrollment('https://cloud.test');

    expect(callbacks.onPending).toHaveBeenCalledWith(
      expect.objectContaining({
        verificationUri: 'https://cloud.test/verify',
        userCode: 'TEST-1234',
      }),
    );
    expect(callbacks.onComplete).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: 'agent-test',
        companyName: 'TestCo',
      }),
    );
    expect(callbacks.onEnrolled).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: 'agent-test',
        companyName: 'TestCo',
        cloudUrl: 'https://cloud.test',
      }),
    );

    expect(protocol.getState()).toEqual({
      state: 'complete',
      agentId: 'agent-test',
      companyName: 'TestCo',
    });
  });

  it('should throw when enrollment already in progress', async () => {
    const protocol = new EnrollmentProtocol(callbacks);
    const promise = protocol.startCloudEnrollment('https://cloud.test');

    await expect(
      protocol.startCloudEnrollment('https://cloud.test'),
    ).rejects.toThrow('Enrollment already in progress');

    await promise;
  });

  it('should stop cleanly', () => {
    const protocol = new EnrollmentProtocol(callbacks);
    protocol.stop();
    expect(protocol.getState()).toEqual({ state: 'idle' });
  });

  // ─── MDM-initiated enrollment ────────────────────────────────

  it('should run enrollment when MDM config present', async () => {
    // Write MDM config
    const dir = path.join(tmpDir, '.agenshield');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'mdm.json'),
      JSON.stringify({
        orgClientId: 'org-client-1',
        cloudUrl: 'https://mdm-cloud.test',
        createdAt: '2025-01-01T00:00:00Z',
      }),
    );

    const protocol = new EnrollmentProtocol(callbacks);
    await protocol.checkAndEnroll();

    // Should have run the full enrollment
    expect(callbacks.onPending).toHaveBeenCalled();
    expect(callbacks.onComplete).toHaveBeenCalled();
    expect(mockInitiateDeviceCode).toHaveBeenCalledWith(
      'https://mdm-cloud.test',
      'org-client-1',
    );
  });

  // ─── stop() with active retry timer ──────────────────────────

  it('should clear retry timer on stop', async () => {
    jest.useFakeTimers();

    // Make initiateDeviceCode fail to trigger retry
    mockInitiateDeviceCode.mockRejectedValueOnce(new Error('network error'));

    const protocol = new EnrollmentProtocol(callbacks);
    await protocol.startCloudEnrollment('https://cloud.test');

    // Should be in failed state with retryAt
    expect(protocol.getState()).toMatchObject({ state: 'failed', error: 'network error' });
    expect((protocol.getState() as { retryAt?: string }).retryAt).toBeDefined();

    // Stop should clear the retry timer
    protocol.stop();

    // Advance past retry delay — should NOT retry
    jest.advanceTimersByTime(120_000);

    // initiateDeviceCode was only called once (the failed one)
    expect(mockInitiateDeviceCode).toHaveBeenCalledTimes(1);
  });

  // ─── Poll returns non-approved status ────────────────────────

  it('should fail when poll returns expired status', async () => {
    mockPollDeviceCode.mockResolvedValueOnce({
      status: 'expired',
      error: 'Device code expired',
    });

    const protocol = new EnrollmentProtocol(callbacks);
    await protocol.startCloudEnrollment('https://cloud.test');

    // Should be in failed state
    expect(protocol.getState()).toMatchObject({
      state: 'failed',
      error: expect.stringContaining('expired'),
    });
    expect(callbacks.onFailed).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.stringContaining('expired'),
      }),
    );
  });

  it('should fail when poll returns denied status', async () => {
    mockPollDeviceCode.mockResolvedValueOnce({
      status: 'denied',
      error: 'User denied',
    });

    const protocol = new EnrollmentProtocol(callbacks);
    await protocol.startCloudEnrollment('https://cloud.test');

    expect(protocol.getState()).toMatchObject({
      state: 'failed',
      error: expect.stringContaining('denied'),
    });
  });

  // ─── Retry on failure ────────────────────────────────────────

  it('should retry on failure with backoff', async () => {
    jest.useFakeTimers();

    // Fail once, then succeed
    mockInitiateDeviceCode
      .mockRejectedValueOnce(new Error('transient error'))
      .mockResolvedValue({
        deviceCode: 'dc-test',
        userCode: 'TEST-1234',
        verificationUri: 'https://cloud.test/verify',
        expiresIn: 900,
        interval: 0.01,
      });

    const protocol = new EnrollmentProtocol(callbacks);
    await protocol.startCloudEnrollment('https://cloud.test');

    // First attempt failed
    expect(protocol.getState()).toMatchObject({
      state: 'failed',
      error: 'transient error',
    });
    expect(callbacks.onFailed).toHaveBeenCalledWith(
      expect.objectContaining({
        error: 'transient error',
        retryAt: expect.any(String),
      }),
    );

    // Advance past RETRY_DELAY_MS (60s)
    await jest.advanceTimersByTimeAsync(60_001);

    // Retry should have succeeded
    expect(callbacks.onComplete).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: 'agent-test' }),
    );
  });

  // ─── Max retries exceeded ───────────────────────────────────

  it('should give up after max retries', async () => {
    jest.useFakeTimers();

    // Always fail
    mockInitiateDeviceCode.mockRejectedValue(new Error('persistent error'));

    const protocol = new EnrollmentProtocol(callbacks);
    await protocol.startCloudEnrollment('https://cloud.test');

    // Attempt 1 failed
    expect(mockInitiateDeviceCode).toHaveBeenCalledTimes(1);

    // Advance through 4 more retries (total 5 = MAX_RETRIES)
    for (let i = 0; i < 4; i++) {
      await jest.advanceTimersByTimeAsync(60_001);
    }

    // Should have been called 5 times total
    expect(mockInitiateDeviceCode).toHaveBeenCalledTimes(5);

    // Final failed state — no retryAt
    expect(protocol.getState()).toMatchObject({
      state: 'failed',
      error: 'persistent error',
    });

    const lastFailedCall = (callbacks.onFailed as jest.Mock).mock.calls.at(-1)![0];
    expect(lastFailedCall.retryAt).toBeUndefined();
  });

  // ─── Stopped during error handling ──────────────────────────

  it('should not retry when stopped during error handling', async () => {
    jest.useFakeTimers();

    mockInitiateDeviceCode.mockRejectedValueOnce(new Error('error'));

    const protocol = new EnrollmentProtocol(callbacks);

    // Use onFailed callback to stop the protocol
    (callbacks.onFailed as jest.Mock).mockImplementation(() => {
      protocol.stop();
    });

    await protocol.startCloudEnrollment('https://cloud.test');

    // Advance past retry delay
    jest.advanceTimersByTime(120_000);

    // Should not have retried — stopped clears timer
    expect(mockInitiateDeviceCode).toHaveBeenCalledTimes(1);
  });

  // ─── Stopped at various checkpoints ──────────────────────────

  it('should abort when stopped before initiateDeviceCode', async () => {
    // Make initiateDeviceCode slow enough to stop before it completes
    let resolveInit!: (val: unknown) => void;
    mockInitiateDeviceCode.mockReturnValueOnce(
      new Promise((resolve) => { resolveInit = resolve; }),
    );

    const protocol = new EnrollmentProtocol(callbacks);
    const promise = protocol.startCloudEnrollment('https://cloud.test');

    // Stop immediately — the protocol is awaiting initiateDeviceCode
    protocol.stop();
    resolveInit({
      deviceCode: 'dc',
      userCode: 'UC',
      verificationUri: 'https://v.test',
      expiresIn: 900,
      interval: 1,
    });

    await promise;

    // Should not have proceeded to onPending
    expect(callbacks.onPending).not.toHaveBeenCalled();
  });

  it('should abort when stopped after poll returns approved', async () => {
    // Make registerDevice slow
    let resolveRegister!: (val: unknown) => void;
    mockRegisterDevice.mockReturnValueOnce(
      new Promise((resolve) => { resolveRegister = resolve; }),
    );

    const protocol = new EnrollmentProtocol(callbacks);
    const promise = protocol.startCloudEnrollment('https://cloud.test');

    // Wait for pending state
    await new Promise(r => setTimeout(r, 10));

    // Stop after poll completes but during registration
    protocol.stop();
    resolveRegister({ agentId: 'agent-x', agentKey: 'key-x' });

    await promise;

    // Should not have completed
    expect(callbacks.onComplete).not.toHaveBeenCalled();
  });

  it('should abort when stopped during error catch block', async () => {
    // Fail the initiateDeviceCode
    mockInitiateDeviceCode.mockRejectedValueOnce(new Error('fail'));

    const protocol = new EnrollmentProtocol(callbacks);

    // Set stopped right before the error handler checks it
    // We can simulate by stopping synchronously when onFailed is about to be called
    // The 'stopped' check at L195 is: if (this.stopped) return;
    // This is checked at the beginning of the catch block, so we need to stop
    // after the throw but before the catch executes — which we can do by
    // making the stop() call from a mock that's called during the try block.

    // Actually, the simplest way: make stopped=true by the time catch runs.
    // Let's mock initiateDeviceCode to stop the protocol then throw
    mockInitiateDeviceCode.mockReset();
    mockInitiateDeviceCode.mockImplementationOnce(async () => {
      protocol.stop();
      throw new Error('stopped-error');
    });

    await protocol.startCloudEnrollment('https://cloud.test');

    // onFailed should NOT have been called because stopped was true in catch
    expect(callbacks.onFailed).not.toHaveBeenCalled();
  });

  it('should abort enrollment when stopped mid-flow', async () => {
    // Make pollDeviceCode hang long enough for stop
    let resolvePoll!: (val: unknown) => void;
    mockPollDeviceCode.mockReturnValueOnce(
      new Promise((resolve) => { resolvePoll = resolve; }),
    );

    const protocol = new EnrollmentProtocol(callbacks);
    const promise = protocol.startCloudEnrollment('https://cloud.test');

    // Stop while waiting for poll
    protocol.stop();
    resolvePoll({ status: 'approved', enrollmentToken: 'et', companyName: 'Co' });

    await promise;

    // Should not have completed — stopped before registration
    expect(callbacks.onComplete).not.toHaveBeenCalled();
  });

  // ─── Branch coverage: stopped guards ─────────────────────────

  it('should return early from runEnrollment when stopped at start (L111)', async () => {
    const protocol = new EnrollmentProtocol(callbacks);

    // Access private method via any to test the stopped guard at L111
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const p = protocol as any;
    p.stopped = true;
    await p.runEnrollment('https://cloud.test');

    // initiateDeviceCode should never be called
    expect(mockInitiateDeviceCode).not.toHaveBeenCalled();
  });

  it('should return early from runEnrollment when stopped after initiate (L119)', async () => {
    const protocol = new EnrollmentProtocol(callbacks);

    // Make initiateDeviceCode trigger stop before returning
    mockInitiateDeviceCode.mockReset();
    mockInitiateDeviceCode.mockImplementationOnce(async () => {
      protocol.stop();
      return {
        deviceCode: 'dc',
        userCode: 'UC',
        verificationUri: 'https://v.test',
        expiresIn: 900,
        interval: 1,
      };
    });

    await protocol.startCloudEnrollment('https://cloud.test');

    // Stopped after initiateDeviceCode but before setting pending state
    expect(callbacks.onPending).not.toHaveBeenCalled();
  });

  it('should return early when stopped after poll (L145)', async () => {
    const protocol = new EnrollmentProtocol(callbacks);

    // Make pollDeviceCode stop the protocol before returning
    mockPollDeviceCode.mockReset();
    mockPollDeviceCode.mockImplementationOnce(async () => {
      protocol.stop();
      return {
        status: 'approved',
        enrollmentToken: 'et-test',
        companyName: 'TestCo',
      };
    });

    await protocol.startCloudEnrollment('https://cloud.test');

    // Should have stopped before registering
    expect(callbacks.onComplete).not.toHaveBeenCalled();
  });

  it('should handle non-approved status with default error message', async () => {
    mockPollDeviceCode.mockReset();
    mockPollDeviceCode.mockResolvedValue({
      status: 'denied',
      // No error field — trigger the default message
    });

    const protocol = new EnrollmentProtocol(callbacks);
    await protocol.startCloudEnrollment('https://cloud.test');

    expect(protocol.getState()).toMatchObject({
      state: 'failed',
      error: expect.stringContaining('Device code was not approved'),
    });
  });

  it('should use fallback companyName when pollResult has none', async () => {
    mockPollDeviceCode.mockReset();
    mockPollDeviceCode.mockResolvedValue({
      status: 'approved',
      enrollmentToken: 'et-test',
      // No companyName — triggers fallback
    });

    const protocol = new EnrollmentProtocol(callbacks);
    await protocol.startCloudEnrollment('https://cloud.test');

    expect(callbacks.onComplete).toHaveBeenCalledWith(
      expect.objectContaining({
        companyName: 'Unknown',
      }),
    );
  });

  // ─── Logger usage ────────────────────────────────────────────

  it('should use provided logger', async () => {
    const logger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    };

    const protocol = new EnrollmentProtocol(callbacks, logger);
    await protocol.startCloudEnrollment('https://cloud.test');

    expect(logger.info).toHaveBeenCalled();
  });
});
