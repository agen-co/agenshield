/**
 * Host user detection — re-exported from @agenshield/keychain.
 *
 * The canonical implementation lives in the keychain library so that
 * keychain operations can delegate to the host user's keychain when
 * running as root. This re-export maintains backward compatibility
 * for all CLI consumers.
 */

export { resolveHostUser, resolveHostHome } from '@agenshield/keychain';
