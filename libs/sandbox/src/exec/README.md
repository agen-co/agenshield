# Exec

Canonical sudo execution helper. Consolidates the previously duplicated `sudoExec` implementations from multiple modules into a single shared function.

## Public API

### Functions

#### `sudoExec(cmd: string): SudoResult`

Execute a shell command with `sudo`. Uses `execSync` with piped stdio. Returns a result object instead of throwing.

```ts
import { sudoExec } from '@agenshield/sandbox';

const result = sudoExec('mkdir -p /opt/agenshield');
if (!result.success) {
  console.error(result.error);
}
```

### Types

#### `SudoResult`

```ts
interface SudoResult {
  success: boolean;
  output?: string;   // stdout (trimmed) on success
  error?: string;    // stderr or message on failure
}
```

## Internal Dependencies

- `node:child_process` (`execSync`)

## Testing

This module wraps a synchronous system call. Tests should mock `execSync` or run in an environment with appropriate sudo access.

## Notes

- This is the single source of truth for sudo execution. All other modules import from `exec/sudo.ts` rather than defining their own version.
- The function never throws; callers must check `result.success`.
