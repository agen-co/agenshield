/**
 * PrivilegeExecutor interface
 *
 * Re-exported from @agenshield/ipc for backwards compatibility.
 * Implementations include:
 * - OsascriptExecutor: macOS native dialog via privilege helper (no terminal needed)
 */

import type { PrivilegeExecResult, PrivilegeExecutor } from '@agenshield/ipc';

/** @deprecated Use PrivilegeExecResult from @agenshield/ipc */
export type ExecResult = PrivilegeExecResult;
export type { PrivilegeExecutor };
