/**
 * Remote skill client interface
 */

import type { RemoteSkillDescriptor, RemoteSearchResponse, VersionCheckResult, UploadMetadata } from '@agenshield/ipc';

export interface RemoteSkillClient {
  search(query: string, opts?: { page?: number; pageSize?: number }): Promise<RemoteSearchResponse>;
  getSkill(remoteId: string): Promise<RemoteSkillDescriptor | null>;
  download(remoteId: string, version?: string): Promise<{ zipBuffer: Buffer; checksum: string; version: string }>;
  upload(zipBuffer: Buffer, metadata: UploadMetadata): Promise<RemoteSkillDescriptor>;
  checkVersion(remoteId: string, currentVersion: string): Promise<VersionCheckResult | null>;
}
