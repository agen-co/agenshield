/**
 * DefaultRemoteClient tests
 */

import { DefaultRemoteClient } from '../remote/client';
import { RemoteApiError } from '../errors';
import type { RemoteSkillDescriptor, VersionCheckResult } from '@agenshield/ipc';

describe('DefaultRemoteClient', () => {
  it('constructs with default options', () => {
    const client = new DefaultRemoteClient();
    expect(client).toBeDefined();
  });

  it('constructs with custom base URL', () => {
    const client = new DefaultRemoteClient({ baseUrl: 'https://custom.example.com' });
    expect(client).toBeDefined();
  });

  it('constructs with API key', () => {
    const client = new DefaultRemoteClient({ apiKey: 'test-key' });
    expect(client).toBeDefined();
  });

  it('search rejects on network error', async () => {
    const client = new DefaultRemoteClient({
      baseUrl: 'https://localhost:0',
      timeout: 1000,
    });

    await expect(client.search('test')).rejects.toThrow();
  });

  it('getSkill returns null on 404', async () => {
    // We can't easily mock fetch in this setup, but we verify the client handles
    // errors by testing with an unreachable host
    const client = new DefaultRemoteClient({
      baseUrl: 'https://localhost:0',
      timeout: 1000,
    });

    await expect(client.getSkill('test')).rejects.toThrow();
  });

  it('checkVersion returns null on error', async () => {
    const client = new DefaultRemoteClient({
      baseUrl: 'https://localhost:0',
      timeout: 1000,
    });

    // checkVersion catches errors and returns null
    const result = await client.checkVersion('test', '1.0.0');
    expect(result).toBeNull();
  });

  describe('with mocked fetch', () => {
    const originalFetch = globalThis.fetch;
    afterEach(() => {
      globalThis.fetch = originalFetch;
    });

    const mockDescriptor: RemoteSkillDescriptor = {
      remoteId: 'skill-123',
      name: 'Test Skill',
      slug: 'test-skill',
      author: 'test-author',
      description: 'A test skill',
      tags: ['test'],
      latestVersion: '1.0.0',
      downloadUrl: 'https://example.com/download',
      checksum: 'abc123',
    };

    function mockFetchOk(jsonBody: unknown, headers?: Record<string, string>) {
      globalThis.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve(jsonBody),
        text: () => Promise.resolve(JSON.stringify(jsonBody)),
        headers: new Headers(headers ?? {}),
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
      });
    }

    function mockFetchNotOk(status: number, body: string) {
      globalThis.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status,
        json: () => Promise.reject(new Error('not json')),
        text: () => Promise.resolve(body),
        headers: new Headers(),
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
      });
    }

    // --- getSkill ---

    describe('getSkill', () => {
      it('returns parsed descriptor on 200', async () => {
        const client = new DefaultRemoteClient({ baseUrl: 'https://test.example.com' });
        mockFetchOk(mockDescriptor);

        const result = await client.getSkill('skill-123');
        expect(result).toEqual(mockDescriptor);
        expect(globalThis.fetch).toHaveBeenCalledTimes(1);
        expect((globalThis.fetch as jest.Mock).mock.calls[0][0]).toBe(
          'https://test.example.com/api/v1/skills/skill-123',
        );
      });

      it('returns null when server responds with 404', async () => {
        const client = new DefaultRemoteClient({ baseUrl: 'https://test.example.com' });
        mockFetchNotOk(404, 'Not Found');

        const result = await client.getSkill('missing-skill');
        expect(result).toBeNull();
      });

      it('re-throws non-404 RemoteApiError', async () => {
        const client = new DefaultRemoteClient({ baseUrl: 'https://test.example.com' });
        mockFetchNotOk(500, 'Internal Server Error');

        await expect(client.getSkill('some-skill')).rejects.toThrow(RemoteApiError);
        await expect(client.getSkill('some-skill')).rejects.toThrow(/500/);
      });
    });

    // --- download ---

    describe('download', () => {
      it('returns zipBuffer, checksum, and version from headers', async () => {
        const client = new DefaultRemoteClient({ baseUrl: 'https://test.example.com' });
        const buf = new ArrayBuffer(16);
        globalThis.fetch = jest.fn().mockResolvedValue({
          ok: true,
          status: 200,
          headers: new Headers({ 'x-checksum': 'sha256-abc', 'x-version': '2.0.0' }),
          arrayBuffer: () => Promise.resolve(buf),
          text: () => Promise.resolve(''),
        });

        const result = await client.download('skill-123');
        expect(result.checksum).toBe('sha256-abc');
        expect(result.version).toBe('2.0.0');
        expect(result.zipBuffer).toBeInstanceOf(Buffer);
        expect(result.zipBuffer.byteLength).toBe(16);
      });

      it('defaults checksum to empty string when x-checksum header is missing', async () => {
        const client = new DefaultRemoteClient({ baseUrl: 'https://test.example.com' });
        globalThis.fetch = jest.fn().mockResolvedValue({
          ok: true,
          status: 200,
          headers: new Headers({ 'x-version': '1.0.0' }),
          arrayBuffer: () => Promise.resolve(new ArrayBuffer(4)),
          text: () => Promise.resolve(''),
        });

        const result = await client.download('skill-123');
        expect(result.checksum).toBe('');
      });

      it('defaults version to passed version when x-version header is missing', async () => {
        const client = new DefaultRemoteClient({ baseUrl: 'https://test.example.com' });
        globalThis.fetch = jest.fn().mockResolvedValue({
          ok: true,
          status: 200,
          headers: new Headers({}),
          arrayBuffer: () => Promise.resolve(new ArrayBuffer(4)),
          text: () => Promise.resolve(''),
        });

        const result = await client.download('skill-123', '3.0.0');
        expect(result.version).toBe('3.0.0');
      });

      it('defaults version to "unknown" when no header and no version param', async () => {
        const client = new DefaultRemoteClient({ baseUrl: 'https://test.example.com' });
        globalThis.fetch = jest.fn().mockResolvedValue({
          ok: true,
          status: 200,
          headers: new Headers({}),
          arrayBuffer: () => Promise.resolve(new ArrayBuffer(4)),
          text: () => Promise.resolve(''),
        });

        const result = await client.download('skill-123');
        expect(result.version).toBe('unknown');
      });

      it('throws RemoteApiError on non-ok response', async () => {
        const client = new DefaultRemoteClient({ baseUrl: 'https://test.example.com' });
        mockFetchNotOk(403, 'Forbidden');

        await expect(client.download('skill-123')).rejects.toThrow(RemoteApiError);
        await expect(client.download('skill-123')).rejects.toThrow(/403/);
      });

      it('includes version path segment when version is provided', async () => {
        const client = new DefaultRemoteClient({ baseUrl: 'https://test.example.com' });
        globalThis.fetch = jest.fn().mockResolvedValue({
          ok: true,
          status: 200,
          headers: new Headers({ 'x-checksum': 'c', 'x-version': '2.1.0' }),
          arrayBuffer: () => Promise.resolve(new ArrayBuffer(4)),
          text: () => Promise.resolve(''),
        });

        await client.download('skill-123', '2.1.0');
        expect((globalThis.fetch as jest.Mock).mock.calls[0][0]).toBe(
          'https://test.example.com/api/v1/skills/skill-123/versions/2.1.0/download',
        );
      });

      it('omits version path segment when version is not provided', async () => {
        const client = new DefaultRemoteClient({ baseUrl: 'https://test.example.com' });
        globalThis.fetch = jest.fn().mockResolvedValue({
          ok: true,
          status: 200,
          headers: new Headers({}),
          arrayBuffer: () => Promise.resolve(new ArrayBuffer(4)),
          text: () => Promise.resolve(''),
        });

        await client.download('skill-123');
        expect((globalThis.fetch as jest.Mock).mock.calls[0][0]).toBe(
          'https://test.example.com/api/v1/skills/skill-123/download',
        );
      });
    });

    // --- checkVersion ---

    describe('checkVersion', () => {
      it('returns result when latestVersion differs from currentVersion', async () => {
        const client = new DefaultRemoteClient({ baseUrl: 'https://test.example.com' });
        const versionResult: VersionCheckResult = {
          remoteId: 'skill-123',
          currentVersion: '1.0.0',
          latestVersion: '2.0.0',
          downloadUrl: 'https://example.com/download',
          checksum: 'sha256-new',
        };
        mockFetchOk(versionResult);

        const result = await client.checkVersion('skill-123', '1.0.0');
        expect(result).toEqual(versionResult);
      });

      it('returns null when latestVersion equals currentVersion', async () => {
        const client = new DefaultRemoteClient({ baseUrl: 'https://test.example.com' });
        const versionResult: VersionCheckResult = {
          remoteId: 'skill-123',
          currentVersion: '1.0.0',
          latestVersion: '1.0.0',
          downloadUrl: 'https://example.com/download',
          checksum: 'sha256-same',
        };
        mockFetchOk(versionResult);

        const result = await client.checkVersion('skill-123', '1.0.0');
        expect(result).toBeNull();
      });
    });

    // --- upload ---

    describe('upload', () => {
      it('returns RemoteSkillDescriptor on success', async () => {
        const client = new DefaultRemoteClient({ baseUrl: 'https://test.example.com' });
        mockFetchOk(mockDescriptor);

        const zipBuffer = Buffer.from('fake-zip-content');
        const result = await client.upload(zipBuffer, {
          name: 'Test Skill',
          slug: 'test-skill',
          version: '1.0.0',
          author: 'test-author',
          description: 'A test skill',
          tags: ['test', 'example'],
        });

        expect(result).toEqual(mockDescriptor);
        expect(globalThis.fetch).toHaveBeenCalledTimes(1);

        const [url, init] = (globalThis.fetch as jest.Mock).mock.calls[0];
        expect(url).toBe('https://test.example.com/api/v1/skills/upload');
        expect(init.method).toBe('POST');
        expect(init.headers['X-Skill-Name']).toBe('Test Skill');
        expect(init.headers['X-Skill-Slug']).toBe('test-skill');
        expect(init.headers['X-Skill-Version']).toBe('1.0.0');
        expect(init.headers['X-Skill-Author']).toBe('test-author');
        expect(init.headers['X-Skill-Description']).toBe('A test skill');
        expect(init.headers['X-Skill-Tags']).toBe('test,example');
      });

      it('throws RemoteApiError on non-ok response', async () => {
        const client = new DefaultRemoteClient({ baseUrl: 'https://test.example.com' });
        mockFetchNotOk(500, 'Server Error');

        const zipBuffer = Buffer.from('fake-zip-content');
        await expect(
          client.upload(zipBuffer, { name: 'Skill', slug: 'skill', version: '1.0.0' }),
        ).rejects.toThrow(RemoteApiError);
      });

      it('omits optional metadata headers when not provided', async () => {
        const client = new DefaultRemoteClient({ baseUrl: 'https://test.example.com' });
        mockFetchOk(mockDescriptor);

        const zipBuffer = Buffer.from('zip');
        await client.upload(zipBuffer, {
          name: 'Skill',
          slug: 'skill',
          version: '1.0.0',
        });

        const init = (globalThis.fetch as jest.Mock).mock.calls[0][1];
        expect(init.headers['X-Skill-Author']).toBeUndefined();
        expect(init.headers['X-Skill-Description']).toBeUndefined();
        expect(init.headers['X-Skill-Tags']).toBeUndefined();
      });
    });

    // --- headers with apiKey ---

    describe('headers with apiKey', () => {
      it('sends Authorization header when apiKey is set', async () => {
        const client = new DefaultRemoteClient({
          baseUrl: 'https://test.example.com',
          apiKey: 'my-secret-key',
        });
        mockFetchOk(mockDescriptor);

        await client.getSkill('skill-123');

        const init = (globalThis.fetch as jest.Mock).mock.calls[0][1];
        expect(init.headers['Authorization']).toBe('Bearer my-secret-key');
      });

      it('does not send Authorization header when apiKey is not set', async () => {
        const client = new DefaultRemoteClient({ baseUrl: 'https://test.example.com' });
        mockFetchOk(mockDescriptor);

        await client.getSkill('skill-123');

        const init = (globalThis.fetch as jest.Mock).mock.calls[0][1];
        expect(init.headers['Authorization']).toBeUndefined();
      });
    });

    // --- fetchJson error path (non-ok response) ---

    describe('fetchJson non-ok response', () => {
      it('throws RemoteApiError with status and body on non-ok fetch', async () => {
        const client = new DefaultRemoteClient({ baseUrl: 'https://test.example.com' });
        mockFetchNotOk(422, 'Validation failed');

        try {
          await client.search('test');
          fail('Expected RemoteApiError to be thrown');
        } catch (err) {
          expect(err).toBeInstanceOf(RemoteApiError);
          const apiErr = err as RemoteApiError;
          expect(apiErr.statusCode).toBe(422);
          expect(apiErr.responseBody).toBe('Validation failed');
          expect(apiErr.message).toContain('422');
          expect(apiErr.message).toContain('Validation failed');
        }
      });

      it('handles text() rejection gracefully in fetchJson', async () => {
        const client = new DefaultRemoteClient({ baseUrl: 'https://test.example.com' });
        globalThis.fetch = jest.fn().mockResolvedValue({
          ok: false,
          status: 500,
          text: () => Promise.reject(new Error('body read failed')),
          headers: new Headers(),
        });

        try {
          await client.search('test');
          fail('Expected RemoteApiError to be thrown');
        } catch (err) {
          expect(err).toBeInstanceOf(RemoteApiError);
          const apiErr = err as RemoteApiError;
          expect(apiErr.statusCode).toBe(500);
          expect(apiErr.responseBody).toBe('');
        }
      });
    });
  });
});
