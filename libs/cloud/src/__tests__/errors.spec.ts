/**
 * Tests for cloud error classes
 */

import {
  CloudError,
  CloudConnectionError,
  CloudAuthError,
  CloudEnrollmentError,
  CloudCommandError,
} from '../errors';

describe('Cloud errors', () => {
  describe('CloudError', () => {
    it('should set name, message, and code', () => {
      const err = new CloudError('test message', 'TEST_CODE');
      expect(err.name).toBe('CloudError');
      expect(err.message).toBe('test message');
      expect(err.code).toBe('TEST_CODE');
      expect(err).toBeInstanceOf(Error);
    });

    it('should use default code', () => {
      const err = new CloudError('test');
      expect(err.code).toBe('CLOUD_ERROR');
    });

    it('should have a stack trace', () => {
      const err = new CloudError('test');
      expect(err.stack).toBeDefined();
    });
  });

  describe('CloudConnectionError', () => {
    it('should set name and code', () => {
      const err = new CloudConnectionError('conn failed', 'https://cloud.test');
      expect(err.name).toBe('CloudConnectionError');
      expect(err.code).toBe('CLOUD_CONNECTION_FAILED');
      expect(err.cloudUrl).toBe('https://cloud.test');
      expect(err).toBeInstanceOf(CloudError);
    });

    it('should use defaults', () => {
      const err = new CloudConnectionError();
      expect(err.message).toBe('Cloud connection failed');
      expect(err.cloudUrl).toBeUndefined();
    });
  });

  describe('CloudAuthError', () => {
    it('should set name, code, and agentId', () => {
      const err = new CloudAuthError('auth failed', 'agent-1');
      expect(err.name).toBe('CloudAuthError');
      expect(err.code).toBe('CLOUD_AUTH_FAILED');
      expect(err.agentId).toBe('agent-1');
      expect(err).toBeInstanceOf(CloudError);
    });

    it('should use defaults when no args provided', () => {
      const err = new CloudAuthError();
      expect(err.message).toBe('Cloud authentication failed');
      expect(err.agentId).toBeUndefined();
    });
  });

  describe('CloudEnrollmentError', () => {
    it('should set retryable flag', () => {
      const err = new CloudEnrollmentError('enrollment failed', false);
      expect(err.name).toBe('CloudEnrollmentError');
      expect(err.code).toBe('CLOUD_ENROLLMENT_FAILED');
      expect(err.retryable).toBe(false);
      expect(err).toBeInstanceOf(CloudError);
    });

    it('should default to retryable', () => {
      const err = new CloudEnrollmentError();
      expect(err.retryable).toBe(true);
    });
  });

  describe('CloudCommandError', () => {
    it('should set method', () => {
      const err = new CloudCommandError('cmd failed', 'push_policy');
      expect(err.name).toBe('CloudCommandError');
      expect(err.code).toBe('CLOUD_COMMAND_FAILED');
      expect(err.method).toBe('push_policy');
      expect(err).toBeInstanceOf(CloudError);
    });

    it('should use defaults when no args provided', () => {
      const err = new CloudCommandError();
      expect(err.message).toBe('Cloud command failed');
      expect(err.method).toBeUndefined();
    });
  });
});
