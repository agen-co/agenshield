/**
 * Daemon Adapters — barrel export
 */

export { DaemonSkillInstaller } from './daemon-installer';
export { DaemonVersionStore } from './daemon-version-store';
export { MCPSkillSource } from './mcp-source';
export type { MCPConnectionConfig } from './mcp-source';
export { createAgenCoConnection } from './mcp-agenco';
export type { AgenCoConnectionDeps } from './mcp-agenco';
export { RemoteSkillSource } from './remote-source';
export type { RemoteSourceDeps } from './remote-source';
