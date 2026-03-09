/**
 * MCP server model — DB row mapper
 */

import type { McpServer } from '@agenshield/ipc';
import type { DbMcpServerRow } from '../../types';

export function mapMcpServer(row: DbMcpServerRow): McpServer {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description ?? '',
    transport: row.transport as McpServer['transport'],
    url: row.url ?? null,
    command: row.command ?? null,
    args: JSON.parse(row.args),
    env: JSON.parse(row.env),
    headers: JSON.parse(row.headers),
    authType: row.auth_type as McpServer['authType'],
    authConfig: row.auth_config ? JSON.parse(row.auth_config) : null,
    source: row.source as McpServer['source'],
    managed: row.managed === 1,
    managedSource: row.managed_source ?? null,
    status: row.status as McpServer['status'],
    profileId: row.profile_id ?? null,
    configJson: row.config_json ? JSON.parse(row.config_json) : null,
    supportedTargets: JSON.parse(row.supported_targets),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
