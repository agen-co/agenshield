/**
 * AgenCo API types
 *
 * Request/Response types for AgenCo routes that forward to MCP Gateway
 */
/** MCP connection state */
export type MCPConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error' | 'unauthorized';
/** MCP status response */
export interface AgenCoMCPStatusResponse {
    state: MCPConnectionState;
    active: boolean;
}
/**
 * Request to start OAuth authentication flow
 */
export interface AgenCoAuthStartRequest {
    /** OAuth scopes to request */
    scopes?: string[];
    /** Source of the auth request: CLI, UI popup, or agent delegation */
    source?: 'cli' | 'ui' | 'agent';
}
/**
 * Response from starting OAuth authentication flow
 */
export interface AgenCoAuthStartResponse {
    /** URL to redirect user to for authentication */
    authUrl: string;
    /** State parameter for CSRF protection */
    state: string;
    /** Port where callback server is listening */
    callbackPort: number;
}
/**
 * Request to complete OAuth authentication (callback)
 */
export interface AgenCoAuthCallbackRequest {
    /** Authorization code from OAuth provider */
    code: string;
    /** State parameter for validation */
    state: string;
}
/**
 * Response from auth callback
 */
export interface AgenCoAuthCallbackResponse {
    success: boolean;
    error?: string;
}
/**
 * Response from auth status check
 */
export interface AgenCoAuthStatusResponse {
    /** Whether user is authenticated */
    authenticated: boolean;
    /** Whether token is expired */
    expired: boolean;
    /** Token expiration time */
    expiresAt: string | null;
    /** List of connected integration IDs */
    connectedIntegrations: string[];
}
/**
 * Request to run a tool
 */
export interface AgenCoToolRunRequest {
    /** Integration identifier (e.g., 'github', 'slack') */
    integration: string;
    /** Tool name within the integration */
    tool: string;
    /** Tool parameters */
    params?: Record<string, unknown>;
}
/**
 * Response from running a tool
 */
export interface AgenCoToolRunResponse {
    success: boolean;
    result?: unknown;
    error?: string;
}
/**
 * Request to list tools
 */
export interface AgenCoToolListRequest {
    /** Filter by integration */
    integration?: string;
    /** Only show tools from connected integrations */
    connectedOnly?: boolean;
}
/**
 * Tool information
 */
export interface AgenCoTool {
    /** Integration this tool belongs to */
    integration: string;
    /** Tool identifier */
    tool: string;
    /** Human-readable description */
    description: string;
    /** Whether the integration is connected */
    connected?: boolean;
    /** URL to connect the integration */
    connectUrl?: string;
}
/**
 * Response from listing tools
 */
export interface AgenCoToolListResponse {
    tools: AgenCoTool[];
}
/**
 * Request to search tools
 */
export interface AgenCoToolSearchRequest {
    /** Search query */
    query: string;
    /** Filter by integration */
    integration?: string;
}
/**
 * Request to list integrations
 */
export interface AgenCoIntegrationsListRequest {
    /** Filter by category */
    category?: string;
    /** Search query */
    search?: string;
}
/**
 * Integration action metadata
 */
export interface AgenCoIntegrationAction {
    /** Action identifier */
    name: string;
    /** Human-readable description */
    description: string;
}
/**
 * Integration information
 */
export interface AgenCoIntegration {
    /** Integration identifier */
    id: string;
    /** Human-readable name */
    name: string;
    /** Description */
    description: string;
    /** Category (e.g., 'communication', 'development') */
    category: string;
    /** Number of tools in this integration */
    toolsCount: number;
    /** Available actions for this integration */
    actions?: AgenCoIntegrationAction[];
}
/**
 * Response from listing available integrations
 */
export interface AgenCoIntegrationsListResponse {
    integrations: AgenCoIntegration[];
    totalCount: number;
}
/**
 * Connected integration information
 */
export interface AgenCoConnectedIntegration {
    /** Integration identifier */
    id: string;
    /** Human-readable name */
    name: string;
    /** When the integration was connected */
    connectedAt: string;
    /** Connection status */
    status: string;
    /** Account/workspace name if applicable */
    account?: string;
    /** Whether re-authentication is required */
    requiresReauth?: boolean;
}
/**
 * Response from listing connected integrations
 */
export interface AgenCoConnectedIntegrationsResponse {
    integrations: AgenCoConnectedIntegration[];
}
/**
 * Request to connect an integration
 */
export interface AgenCoConnectIntegrationRequest {
    /** Integration identifier */
    integration: string;
    /** Optional OAuth scopes */
    scopes?: string[];
}
/**
 * Response from connecting an integration
 */
export interface AgenCoConnectIntegrationResponse {
    /** Connection status */
    status: 'auth_required' | 'already_connected' | 'connected';
    /** OAuth URL if authentication is required */
    oauthUrl?: string;
    /** Expiration time if applicable */
    expiresIn?: number;
    /** Additional instructions */
    instructions?: string;
    /** Connected account name */
    account?: string;
    /** When the integration was connected */
    connectedAt?: string;
}
//# sourceMappingURL=agenco.d.ts.map