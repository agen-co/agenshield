/**
 * Vault-backed OAuth provider for MCP SDK
 *
 * Implements OAuthClientProvider using the encrypted vault for
 * persisting client credentials and tokens. PKCE code verifier
 * is kept in-memory (single auth session at a time).
 */

import type { OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js';
import type {
  OAuthClientMetadata,
  OAuthTokens,
  OAuthClientInformationFull,
} from '@modelcontextprotocol/sdk/shared/auth.js';
import { getVault } from '../vault';
import {
  emitAgentLinkAuthRequired,
  emitAgentLinkAuthCompleted,
} from '../events/emitter';

const TAG = '\x1b[35m[OAuth]\x1b[0m';

export class VaultOAuthProvider implements OAuthClientProvider {
  private _codeVerifier = '';
  private _authUrl: string | null = null;
  private daemonPort: number;

  constructor(daemonPort: number) {
    this.daemonPort = daemonPort;
  }

  /** Auth URL captured during redirectToAuthorization */
  get capturedAuthUrl(): string | null {
    return this._authUrl;
  }

  get redirectUrl(): string {
    return `http://localhost:${this.daemonPort}/api/agentlink/auth/oauth-callback`;
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      redirect_uris: [this.redirectUrl],
      client_name: 'AgenShield',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'client_secret_post',
    };
  }

  async clientInformation(): Promise<OAuthClientInformationFull | undefined> {
    const vault = getVault();
    const v = await vault.get('agentlink');
    if (!v?.clientId) {
      console.log(`${TAG} No client credentials in vault — DCR will be triggered`);
      return undefined;
    }
    console.log(`${TAG} Loaded client credentials from vault (client_id: ${v.clientId.slice(0, 8)}…)`);
    return {
      client_id: v.clientId,
      client_secret: v.clientSecret,
      ...this.clientMetadata,
    };
  }

  async saveClientInformation(info: OAuthClientInformationFull): Promise<void> {
    console.log(`${TAG} Saving client credentials (client_id: ${info.client_id.slice(0, 8)}…)`);
    const vault = getVault();
    const existing = await vault.get('agentlink');
    await vault.set('agentlink', {
      clientId: info.client_id,
      clientSecret: info.client_secret || '',
      accessToken: existing?.accessToken || '',
      refreshToken: existing?.refreshToken || '',
      expiresAt: existing?.expiresAt || 0,
    });
  }

  async tokens(): Promise<OAuthTokens | undefined> {
    const vault = getVault();
    const v = await vault.get('agentlink');
    if (!v?.accessToken) {
      console.log(`${TAG} No tokens in vault`);
      return undefined;
    }
    console.log(`${TAG} Loaded tokens from vault (expires: ${v.expiresAt ? new Date(v.expiresAt).toISOString() : 'unknown'})`);
    return {
      access_token: v.accessToken,
      token_type: 'bearer',
      refresh_token: v.refreshToken || undefined,
    };
  }

  async saveTokens(tokens: OAuthTokens): Promise<void> {
    console.log(`${TAG} Saving tokens (expires_in: ${tokens.expires_in ?? 'none'})`);
    const vault = getVault();
    const existing = await vault.get('agentlink');
    await vault.set('agentlink', {
      clientId: existing?.clientId || '',
      clientSecret: existing?.clientSecret || '',
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token || existing?.refreshToken || '',
      expiresAt: tokens.expires_in
        ? Date.now() + tokens.expires_in * 1000
        : existing?.expiresAt || 0,
    });

    emitAgentLinkAuthCompleted();
  }

  async redirectToAuthorization(authorizationUrl: URL): Promise<void> {
    this._authUrl = authorizationUrl.toString();
    console.log(`${TAG} Authorization URL captured → ${this._authUrl.slice(0, 100)}…`);
    emitAgentLinkAuthRequired(this._authUrl);
  }

  async saveCodeVerifier(codeVerifier: string): Promise<void> {
    console.log(`${TAG} PKCE code verifier saved`);
    this._codeVerifier = codeVerifier;
  }

  async codeVerifier(): Promise<string> {
    return this._codeVerifier;
  }
}
