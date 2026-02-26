/**
 * Binary signature model — DB row mapper
 */

import type { BinarySignature } from '@agenshield/ipc';
import type { DbBinarySignatureRow } from '../../types';

export function mapSignature(row: DbBinarySignatureRow): BinarySignature {
  return {
    id: row.id,
    sha256: row.sha256,
    packageName: row.package_name,
    version: row.version ?? undefined,
    platform: row.platform ?? undefined,
    source: row.source as BinarySignature['source'],
    metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
