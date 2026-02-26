/**
 * Ink-based text input prompt.
 *
 * Wraps `ink-text-input` with Enter to submit and Esc to cancel.
 * Falls back to readline when not in an interactive TTY.
 */

import React, { useState } from 'react';
import { render, Box, Text, useInput, useApp } from 'ink';
import TextInput from 'ink-text-input';
import { getOutputOptions } from '../utils/output.js';
import { readlineInput } from './readline-fallback.js';

// ── Types ──────────────────────────────────────────────────────────────

export interface InputConfig {
  prompt: string;
  defaultValue?: string;
  placeholder?: string;
}

// ── Ink component ──────────────────────────────────────────────────────

interface InputComponentProps {
  config: InputConfig;
  onSubmit: (value: string) => void;
  onCancel: () => void;
}

function InputComponent({ config, onSubmit, onCancel }: InputComponentProps) {
  const [value, setValue] = useState(config.defaultValue ?? '');
  const app = useApp();

  useInput((_input, key) => {
    if (key.escape) {
      onCancel();
      app.exit();
    }
  });

  const handleSubmit = (submitted: string) => {
    onSubmit(submitted.trim() || config.defaultValue || '');
    app.exit();
  };

  return (
    <Box flexDirection="column" marginLeft={1}>
      <Box>
        <Text bold color="cyan">
          {config.prompt}
        </Text>
        {config.defaultValue && (
          <Text color="gray"> ({config.defaultValue})</Text>
        )}
      </Box>
      <Box marginTop={1}>
        <Text color="green">&gt; </Text>
        <TextInput
          value={value}
          onChange={setValue}
          onSubmit={handleSubmit}
          placeholder={config.placeholder}
        />
      </Box>
      <Box marginTop={1}>
        <Text color="gray" dimColor>
          Enter to confirm, Esc to cancel
        </Text>
      </Box>
    </Box>
  );
}

// ── Public API ─────────────────────────────────────────────────────────

/**
 * Show an interactive text input prompt.
 *
 * Returns the entered string, or `null` if the user pressed Esc.
 * Falls back to readline when not interactive.
 */
export async function inkInput(config: InputConfig): Promise<string | null> {
  const opts = getOutputOptions();
  const interactive = !opts.json && !opts.quiet && process.stderr.isTTY !== false;

  if (!interactive) {
    return readlineInput(config);
  }

  let result: string | null = null;

  const { waitUntilExit } = render(
    React.createElement(InputComponent, {
      config,
      onSubmit: (value: string) => {
        result = value;
      },
      onCancel: () => {
        result = null;
      },
    }),
    { stdout: process.stderr },
  );

  await waitUntilExit();
  return result;
}
