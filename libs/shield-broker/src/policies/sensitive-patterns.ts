/**
 * Centralized Sensitive File Patterns
 *
 * Single source of truth for all secret/credential file patterns.
 * Used by:
 * - PolicyEnforcer (glob-based broker-level enforcement)
 * - Seatbelt profiles (absolute path kernel-level enforcement)
 */

import * as path from 'node:path';

// ── Glob patterns (broker enforcer) ──────────────────────────────

/**
 * Glob patterns that match sensitive files across any directory.
 * Used in builtin deny rules and fsConstraints.deniedPatterns.
 */
export const SENSITIVE_FILE_PATTERNS: string[] = [
  // Environment files
  '**/.env',
  '**/.env.*',

  // AWS
  '**/.aws/credentials',
  '**/.aws/config',

  // Firebase / Google Cloud
  '**/firebase-adminsdk*.json',
  '**/application_default_credentials.json',
  '**/.config/gcloud/credentials.db',
  '**/.config/gcloud/application_default_credentials.json',

  // SSH
  '**/.ssh/*',
  '**/id_rsa',
  '**/id_rsa.*',
  '**/id_ed25519',
  '**/id_ed25519.*',
  '**/id_ecdsa',
  '**/id_ecdsa.*',
  '**/id_dsa',

  // GPG
  '**/.gnupg/private-keys-v1.d/*',
  '**/.gnupg/secring.gpg',

  // Docker
  '**/.docker/config.json',

  // Package managers
  '**/.npmrc',
  '**/.yarnrc',
  '**/.yarnrc.yml',

  // Kubernetes
  '**/.kube/config',
  '**/kubeconfig',
  '**/kubeconfig.*',

  // Terraform
  '**/*.tfstate',
  '**/*.tfstate.*',
  '**/*.tfvars',
  '**/*.tfvars.json',

  // Vault
  '**/.vault-token',

  // Certificates & keys
  '**/*.p12',
  '**/*.pfx',
  '**/*.jks',
  '**/*.keystore',
  '**/*.key',
  '**/*.pem',

  // Generic secrets
  '**/secrets.json',
  '**/secrets.yaml',
  '**/secrets.yml',
  '**/secrets.toml',
  '**/secrets.env',
  '**/credentials.json',
  '**/credentials.yaml',
  '**/service-account*.json',

  // DB credentials
  '**/.pgpass',
  '**/.my.cnf',

  // Network credentials
  '**/.netrc',
  '**/.curlrc',

  // Azure
  '**/.azure/accessTokens.json',
  '**/.azure/azureProfile.json',

  // Platform tokens
  '**/.heroku/credentials',
  '**/.vercel/auth.json',
  '**/.netlify/config.json',
  '**/.config/gh/hosts.yml',
];

// ── Home-relative paths (seatbelt literal/subpath rules) ─────────

/**
 * Paths relative to $HOME that contain secrets.
 * Used to generate absolute seatbelt deny rules (literal/subpath).
 *
 * Entries ending with '/' are treated as directories (seatbelt subpath).
 * All others are treated as files (seatbelt literal).
 */
export const SENSITIVE_HOME_PATHS: string[] = [
  // SSH (directory)
  '.ssh/',

  // GPG (directory)
  '.gnupg/private-keys-v1.d/',
  '.gnupg/secring.gpg',

  // AWS
  '.aws/credentials',
  '.aws/config',

  // Docker
  '.docker/config.json',

  // Kubernetes
  '.kube/config',

  // Package managers
  '.npmrc',
  '.yarnrc',
  '.yarnrc.yml',

  // Vault
  '.vault-token',

  // Network credentials
  '.netrc',
  '.curlrc',

  // DB credentials
  '.pgpass',
  '.my.cnf',

  // Google Cloud (directory)
  '.config/gcloud/',

  // Azure
  '.azure/accessTokens.json',
  '.azure/azureProfile.json',

  // Platform tokens
  '.heroku/credentials',
  '.vercel/auth.json',
  '.netlify/config.json',
  '.config/gh/hosts.yml',
];

/**
 * Expand home-relative sensitive paths into absolute paths.
 *
 * @param homeDir - Absolute path to the user's home directory
 * @returns Absolute paths suitable for seatbelt literal/subpath rules
 */
export function expandSensitiveHomePaths(homeDir: string): string[] {
  return SENSITIVE_HOME_PATHS.map((rel) => path.join(homeDir, rel));
}
