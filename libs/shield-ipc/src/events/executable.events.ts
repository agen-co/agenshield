import { registerEventTypes } from './event-registry';

export interface ExecutableDetectedPayload {
  name: string;
  directory: string;
  sourceType: 'pip' | 'homebrew' | 'npm';
}

export interface ExecutableWrappedPayload {
  name: string;
  symlinkPath: string;
  originalPath: string;
  sourceType: 'pip' | 'homebrew' | 'npm';
}

export interface ExecutableSkippedPayload {
  name: string;
  reason: 'already_exists' | 'protected' | 'write_failed';
}

export interface ExecutableScanCompletePayload {
  detected: number;
  wrapped: number;
  skipped: number;
  directories: string[];
}

declare module '@agenshield/ipc' {
  interface EventRegistry {
    'executables:detected': ExecutableDetectedPayload;
    'executables:wrapped': ExecutableWrappedPayload;
    'executables:skipped': ExecutableSkippedPayload;
    'executables:scan_complete': ExecutableScanCompletePayload;
  }
}

export const EXECUTABLE_EVENT_TYPES = [
  'executables:detected',
  'executables:wrapped',
  'executables:skipped',
  'executables:scan_complete',
] as const;

registerEventTypes(EXECUTABLE_EVENT_TYPES);
