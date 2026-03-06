import { handleOpenUrl } from '../../handlers/open-url.js';
import { createHandlerContext, createMockDeps } from '../helpers.js';

const mockForwardOpenUrl = jest.fn();

jest.mock('../../daemon-forward.js', () => ({
  forwardPolicyToDaemon: jest.fn().mockResolvedValue(null),
  forwardEventsToDaemon: jest.fn(),
  forwardOpenUrlToDaemon: (...args: unknown[]) => mockForwardOpenUrl(...args),
}));

describe('handleOpenUrl', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should return error 1003 when url is missing', async () => {
    const result = await handleOpenUrl({}, createHandlerContext(), createMockDeps());
    expect(result.success).toBe(false);
    expect(result.error!.code).toBe(1003);
  });

  it('should return error 1003 for invalid URL', async () => {
    const result = await handleOpenUrl({ url: 'not-a-url' }, createHandlerContext(), createMockDeps());
    expect(result.success).toBe(false);
    expect(result.error!.code).toBe(1003);
  });

  it('should return error 1003 for non-http protocol', async () => {
    const result = await handleOpenUrl({ url: 'ftp://files.example.com' }, createHandlerContext(), createMockDeps());
    expect(result.success).toBe(false);
    expect(result.error!.code).toBe(1003);
    expect(result.error!.message).toContain('http/https');
  });

  it('should return opened:true when daemon reports success', async () => {
    mockForwardOpenUrl.mockResolvedValue({ opened: true });
    const result = await handleOpenUrl({ url: 'https://example.com' }, createHandlerContext(), createMockDeps());
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ opened: true });
  });

  it('should return error 1006 when daemon reports failure', async () => {
    mockForwardOpenUrl.mockResolvedValue({ opened: false, reason: 'Policy denied' });
    const result = await handleOpenUrl({ url: 'https://blocked.com' }, createHandlerContext(), createMockDeps());
    expect(result.success).toBe(false);
    expect(result.error!.code).toBe(1006);
    expect(result.error!.message).toContain('Policy denied');
  });

  it('should return error 1006 when daemon returns null', async () => {
    mockForwardOpenUrl.mockResolvedValue(null);
    const result = await handleOpenUrl({ url: 'https://example.com' }, createHandlerContext(), createMockDeps());
    expect(result.success).toBe(false);
    expect(result.error!.code).toBe(1006);
  });

  it('should return error 1006 on handler exception', async () => {
    mockForwardOpenUrl.mockRejectedValue(new Error('network error'));
    const result = await handleOpenUrl({ url: 'https://example.com' }, createHandlerContext(), createMockDeps());
    expect(result.success).toBe(false);
    expect(result.error!.code).toBe(1006);
    expect(result.error!.message).toContain('network error');
  });
});
