/**
 * State schemas — Zod validation schemas and derived types
 */

import { z } from 'zod';

// ---- Update schemas ----

export const UpdateDaemonSchema = z.object({
  running: z.boolean().optional(),
  pid: z.number().nullable().optional(),
  startedAt: z.string().nullable().optional(),
  port: z.number().optional(),
});
export type UpdateDaemonInput = z.input<typeof UpdateDaemonSchema>;

export const UpdateAgenCoSchema = z.object({
  authenticated: z.boolean().optional(),
  lastAuthAt: z.string().nullable().optional(),
  connectedIntegrations: z.array(z.string()).optional(),
});
export type UpdateAgenCoInput = z.input<typeof UpdateAgenCoSchema>;

export const UpdateInstallationSchema = z.object({
  preset: z.string().optional(),
  baseName: z.string().optional(),
  prefix: z.string().nullable().optional(),
  wrappers: z.array(z.string()).optional(),
  seatbeltInstalled: z.boolean().optional(),
});
export type UpdateInstallationInput = z.input<typeof UpdateInstallationSchema>;

export const UpdatePasscodeSchema = z.object({
  enabled: z.boolean().optional(),
  allowAnonymousReadOnly: z.boolean().optional(),
  failedAttempts: z.number().optional(),
  lockedUntil: z.string().nullable().optional(),
});
export type UpdatePasscodeInput = z.input<typeof UpdatePasscodeSchema>;

// ---- Codecs: domain (camelCase) → DB params (snake_case) ----

export const UpdateDaemonCodec = z.codec(
  z.record(z.string(), z.unknown()),
  UpdateDaemonSchema,
  {
    decode: (db) => db as UpdateDaemonInput,
    encode: (data) => ({
      daemon_running: data.running !== undefined ? (data.running ? 1 : 0) : undefined,
      daemon_pid: data.pid !== undefined ? (data.pid ?? null) : undefined,
      daemon_started_at: data.startedAt !== undefined ? (data.startedAt ?? null) : undefined,
      daemon_port: data.port,
    }),
  }
);

export const UpdateAgenCoCodec = z.codec(
  z.record(z.string(), z.unknown()),
  UpdateAgenCoSchema,
  {
    decode: (db) => db as UpdateAgenCoInput,
    encode: (data) => ({
      agenco_authenticated: data.authenticated !== undefined ? (data.authenticated ? 1 : 0) : undefined,
      agenco_last_auth_at: data.lastAuthAt !== undefined ? (data.lastAuthAt ?? null) : undefined,
      agenco_connected_integrations: data.connectedIntegrations !== undefined ? JSON.stringify(data.connectedIntegrations) : undefined,
    }),
  }
);

export const UpdateInstallationCodec = z.codec(
  z.record(z.string(), z.unknown()),
  UpdateInstallationSchema,
  {
    decode: (db) => db as UpdateInstallationInput,
    encode: (data) => ({
      installation_preset: data.preset,
      installation_base_name: data.baseName,
      installation_prefix: data.prefix !== undefined ? (data.prefix ?? null) : undefined,
      installation_wrappers: data.wrappers !== undefined ? JSON.stringify(data.wrappers) : undefined,
      installation_seatbelt_installed: data.seatbeltInstalled !== undefined ? (data.seatbeltInstalled ? 1 : 0) : undefined,
    }),
  }
);

export const UpdatePasscodeCodec = z.codec(
  z.record(z.string(), z.unknown()),
  UpdatePasscodeSchema,
  {
    decode: (db) => db as UpdatePasscodeInput,
    encode: (data) => ({
      passcode_enabled: data.enabled !== undefined ? (data.enabled ? 1 : 0) : undefined,
      passcode_allow_anonymous_read_only: data.allowAnonymousReadOnly !== undefined ? (data.allowAnonymousReadOnly ? 1 : 0) : undefined,
      passcode_failed_attempts: data.failedAttempts,
      passcode_locked_until: data.lockedUntil !== undefined ? (data.lockedUntil ?? null) : undefined,
    }),
  }
);
