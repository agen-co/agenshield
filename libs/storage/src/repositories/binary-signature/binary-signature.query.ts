/**
 * Binary signature SQL queries
 */

const TABLE = 'binary_signatures';

export const Q = {
  insert: `
    INSERT INTO ${TABLE} (id, sha256, package_name, version, platform, source, metadata, created_at, updated_at)
    VALUES (@id, @sha256, @packageName, @version, @platform, @source, @metadata, @createdAt, @updatedAt)`,

  upsert: `
    INSERT INTO ${TABLE} (id, sha256, package_name, version, platform, source, metadata, created_at, updated_at)
    VALUES (@id, @sha256, @packageName, @version, @platform, @source, @metadata, @createdAt, @updatedAt)
    ON CONFLICT (sha256, platform) DO UPDATE SET
      package_name = excluded.package_name,
      version = excluded.version,
      source = excluded.source,
      metadata = excluded.metadata,
      updated_at = excluded.updated_at`,

  selectById: `SELECT * FROM ${TABLE} WHERE id = ?`,

  selectBySha256: `SELECT * FROM ${TABLE} WHERE sha256 = @sha256`,

  selectBySha256Platform: `SELECT * FROM ${TABLE} WHERE sha256 = @sha256 AND platform = @platform`,

  selectByPackage: `SELECT * FROM ${TABLE} WHERE package_name = @packageName`,

  selectAll: `SELECT * FROM ${TABLE} ORDER BY package_name, created_at`,

  deleteById: `DELETE FROM ${TABLE} WHERE id = ?`,

  deleteBySource: `DELETE FROM ${TABLE} WHERE source = @source`,

  count: `SELECT COUNT(*) as count FROM ${TABLE}`,
} as const;
