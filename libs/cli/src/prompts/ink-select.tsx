/**
 * Ink-based arrow-key selection prompt.
 *
 * Renders a list of options navigable with arrow keys / number shortcuts.
 * Falls back to readline when not in an interactive TTY.
 */

import React, { useState } from 'react';
import { render, Box, Text, useInput, useApp } from 'ink';
import { getOutputOptions } from '../utils/output.js';
import { readlineSelect } from './readline-fallback.js';

// ── Types ──────────────────────────────────────────────────────────────

export interface SelectOption<T extends string = string> {
  label: string;
  value: T;
  description?: string;
}

export interface SelectConfig {
  title?: string;
  subtitle?: string;
}

// ── Ink component ──────────────────────────────────────────────────────

interface SelectComponentProps {
  options: SelectOption[];
  config?: SelectConfig;
  onSelect: (value: string) => void;
  onCancel: () => void;
}

function SelectComponent({
  options,
  config,
  onSelect,
  onCancel,
}: SelectComponentProps) {
  const [index, setIndex] = useState(0);
  const app = useApp();

  useInput((input, key) => {
    if (key.upArrow) {
      setIndex((i) => (i - 1 + options.length) % options.length);
    }
    if (key.downArrow) {
      setIndex((i) => (i + 1) % options.length);
    }

    // Number shortcuts: 1-9
    const num = parseInt(input, 10);
    if (num >= 1 && num <= options.length) {
      setIndex(num - 1);
    }

    if (key.return) {
      onSelect(options[index].value);
      app.exit();
    }

    if (key.escape) {
      onCancel();
      app.exit();
    }
  });

  return (
    <Box flexDirection="column" marginLeft={1}>
      {config?.title && (
        <Box marginBottom={1}>
          <Text bold color="cyan">
            {config.title}
          </Text>
        </Box>
      )}
      {config?.subtitle && (
        <Box marginBottom={1}>
          <Text color="gray">{config.subtitle}</Text>
        </Box>
      )}

      {options.map((opt, i) => (
        <Box key={opt.value} flexDirection="column">
          <Box>
            <Text color={i === index ? 'green' : 'gray'}>
              {i === index ? '> ' : '  '}
            </Text>
            <Text bold={i === index} color={i === index ? 'green' : 'white'}>
              {opt.label}
            </Text>
          </Box>
          {opt.description && (
            <Box marginLeft={4}>
              <Text color="gray">{opt.description}</Text>
            </Box>
          )}
        </Box>
      ))}

      <Box marginTop={1}>
        <Text color="gray" dimColor>
          Arrow keys to select, Enter to confirm, Esc to cancel
        </Text>
      </Box>
    </Box>
  );
}

// ── Public API ─────────────────────────────────────────────────────────

/**
 * Show an interactive arrow-key selection prompt.
 *
 * Returns the selected value, or `null` if the user pressed Esc.
 * Falls back to readline-based numbered selection when not interactive.
 */
export async function inkSelect<T extends string>(
  options: SelectOption<T>[],
  config?: SelectConfig,
): Promise<T | null> {
  const opts = getOutputOptions();
  const interactive = !opts.json && !opts.quiet && process.stderr.isTTY !== false;

  if (!interactive) {
    return readlineSelect(options, config);
  }

  let result: T | null = null;

  const { waitUntilExit } = render(
    React.createElement(SelectComponent, {
      options: options as SelectOption[],
      config,
      onSelect: (value: string) => {
        result = value as T;
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
