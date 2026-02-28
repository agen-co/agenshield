/**
 * CLI entry point for SEA bundle.
 * Delegates to the actual CLI main module.
 */

// Re-export the CLI entrypoint — esbuild will bundle it inline
import '../../libs/cli/src/cli';
