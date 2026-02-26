/**
 * Ink-based interactive browser link prompt.
 *
 * Displays a URL and offers "Press Enter to open, Esc to skip".
 * Falls back to printing the URL when not interactive.
 */

import React from 'react';
import { render, Box, Text, useInput, useApp } from 'ink';
import { execSync } from 'node:child_process';
import { getOutputOptions } from '../utils/output.js';
import { output } from '../utils/output.js';

// ── Types ──────────────────────────────────────────────────────────────

export interface BrowserLinkConfig {
  url: string;
  label?: string;
  token?: string;
}

// ── Ink component ──────────────────────────────────────────────────────

interface BrowserLinkComponentProps {
  config: BrowserLinkConfig;
  onResult: (result: 'opened' | 'skipped') => void;
}

function BrowserLinkComponent({ config, onResult }: BrowserLinkComponentProps) {
  const app = useApp();

  useInput((_input, key) => {
    if (key.return) {
      try {
        const cmd =
          process.platform === 'darwin'
            ? `open "${config.url}"`
            : `xdg-open "${config.url}"`;
        execSync(cmd, { stdio: 'pipe' });
      } catch {
        // Silently ignore — the URL is displayed for manual copy
      }
      onResult('opened');
      app.exit();
    }

    if (key.escape) {
      onResult('skipped');
      app.exit();
    }
  });

  return (
    <Box flexDirection="column" marginLeft={1}>
      <Box>
        <Text bold>{config.label ?? 'URL'}:</Text>
      </Box>
      <Box marginLeft={2}>
        <Text color="cyan">{config.url}</Text>
      </Box>
      {config.token && (
        <Box marginLeft={2} marginTop={1}>
          <Text dimColor>Token: {config.token}</Text>
        </Box>
      )}
      <Box marginTop={1}>
        <Text color="gray" dimColor>
          Press Enter to open in browser, Esc to skip
        </Text>
      </Box>
    </Box>
  );
}

// ── Public API ─────────────────────────────────────────────────────────

/**
 * Show an interactive browser link prompt.
 *
 * Returns `'opened'` if the user pressed Enter (browser opened),
 * or `'skipped'` if the user pressed Esc or the environment is non-interactive.
 */
export async function inkBrowserLink(
  config: BrowserLinkConfig,
): Promise<'opened' | 'skipped'> {
  const opts = getOutputOptions();
  const interactive = !opts.json && !opts.quiet && process.stderr.isTTY !== false;

  if (!interactive) {
    // Non-interactive: just print the URL
    if (config.label) {
      output.info(`  ${config.label}:`);
    }
    output.info(`  ${output.cyan(config.url)}`);
    if (config.token) {
      output.info(`  ${output.dim(`Token: ${config.token}`)}`);
    }
    return 'skipped';
  }

  let result: 'opened' | 'skipped' = 'skipped';

  const { waitUntilExit } = render(
    React.createElement(BrowserLinkComponent, {
      config,
      onResult: (r: 'opened' | 'skipped') => {
        result = r;
      },
    }),
    { stdout: process.stderr },
  );

  await waitUntilExit();
  return result;
}
