import { registerEventTypes } from './event-registry';

export interface WorkspacePathGrantedPayload {
  profileId: string;
  path: string;
  profileName?: string;
}

export interface WorkspacePathRevokedPayload {
  profileId: string;
  path: string;
}

export interface WorkspaceSensitiveFilesProtectedPayload {
  workspacePath: string;
  fileCount: number;
  files: string[];
}

declare module '@agenshield/ipc' {
  interface EventRegistry {
    'workspace:path_granted': WorkspacePathGrantedPayload;
    'workspace:path_revoked': WorkspacePathRevokedPayload;
    'workspace:sensitive_files_protected': WorkspaceSensitiveFilesProtectedPayload;
  }
}

export const WORKSPACE_EVENT_TYPES = [
  'workspace:path_granted',
  'workspace:path_revoked',
  'workspace:sensitive_files_protected',
] as const;

registerEventTypes(WORKSPACE_EVENT_TYPES);
