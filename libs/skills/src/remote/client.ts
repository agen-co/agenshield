/**
 * Default remote client — HTTP client for the skills marketplace
 */

import type { RemoteSkillDescriptor, RemoteSearchResponse, VersionCheckResult, UploadMetadata } from '@agenshield/ipc';
import type { RemoteSkillClient } from './types';
import { RemoteApiError } from '../errors';

const DEFAULT_BASE_URL = 'https://skills.agentfront.dev';

export interface DefaultRemoteClientOptions {
  baseUrl?: string;
  apiKey?: string;
  timeout?: number;
}

export class DefaultRemoteClient implements RemoteSkillClient {
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly timeout: number;

  constructor(options?: DefaultRemoteClientOptions) {
    this.baseUrl = (options?.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '');
    this.apiKey = options?.apiKey;
    this.timeout = options?.timeout ?? 30_000;
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.apiKey) h['Authorization'] = `Bearer ${this.apiKey}`;
    return h;
  }

  private async fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);

    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        headers: { ...this.headers(), ...init?.headers },
        signal: controller.signal,
      });

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new RemoteApiError(`Remote API error ${res.status}: ${body}`, res.status, body);
      }

      return (await res.json()) as T;
    } finally {
      clearTimeout(timer);
    }
  }

  async search(query: string, opts?: { page?: number; pageSize?: number }): Promise<RemoteSearchResponse> {
    const params = new URLSearchParams({ q: query });
    if (opts?.page != null) params.set('page', String(opts.page));
    if (opts?.pageSize != null) params.set('pageSize', String(opts.pageSize));

    return this.fetchJson<RemoteSearchResponse>(`/api/v1/skills/search?${params}`);
  }

  async getSkill(remoteId: string): Promise<RemoteSkillDescriptor | null> {
    try {
      return await this.fetchJson<RemoteSkillDescriptor>(`/api/v1/skills/${encodeURIComponent(remoteId)}`);
    } catch (err) {
      if (err instanceof Error && err.message.includes('404')) return null;
      throw err;
    }
  }

  async download(remoteId: string, version?: string): Promise<{ zipBuffer: Buffer; checksum: string; version: string }> {
    const versionPath = version ? `/versions/${encodeURIComponent(version)}` : '';
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout * 3);

    try {
      const res = await fetch(
        `${this.baseUrl}/api/v1/skills/${encodeURIComponent(remoteId)}${versionPath}/download`,
        { headers: this.headers(), signal: controller.signal },
      );

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new RemoteApiError(`Download failed ${res.status}: ${body}`, res.status, body);
      }

      const checksum = res.headers.get('x-checksum') ?? '';
      const resolvedVersion = res.headers.get('x-version') ?? version ?? 'unknown';
      const arrayBuffer = await res.arrayBuffer();

      return { zipBuffer: Buffer.from(arrayBuffer), checksum, version: resolvedVersion };
    } finally {
      clearTimeout(timer);
    }
  }

  async upload(zipBuffer: Buffer, metadata: UploadMetadata): Promise<RemoteSkillDescriptor> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout * 3);

    try {
      const res = await fetch(`${this.baseUrl}/api/v1/skills/upload`, {
        method: 'POST',
        headers: {
          ...this.headers(),
          'Content-Type': 'application/octet-stream',
          'X-Skill-Name': metadata.name,
          'X-Skill-Slug': metadata.slug,
          'X-Skill-Version': metadata.version,
          ...(metadata.author ? { 'X-Skill-Author': metadata.author } : {}),
          ...(metadata.description ? { 'X-Skill-Description': metadata.description } : {}),
          ...(metadata.tags?.length ? { 'X-Skill-Tags': metadata.tags.join(',') } : {}),
        },
        body: zipBuffer.buffer.slice(zipBuffer.byteOffset, zipBuffer.byteOffset + zipBuffer.byteLength) as ArrayBuffer,
        signal: controller.signal,
      });

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new RemoteApiError(`Upload failed ${res.status}: ${body}`, res.status, body);
      }

      return (await res.json()) as RemoteSkillDescriptor;
    } finally {
      clearTimeout(timer);
    }
  }

  async checkVersion(remoteId: string, currentVersion: string): Promise<VersionCheckResult | null> {
    try {
      const result = await this.fetchJson<VersionCheckResult>(
        `/api/v1/skills/${encodeURIComponent(remoteId)}/check-update?current=${encodeURIComponent(currentVersion)}`,
      );
      return result.latestVersion !== currentVersion ? result : null;
    } catch {
      return null;
    }
  }
}
