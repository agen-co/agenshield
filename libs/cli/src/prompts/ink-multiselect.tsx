/**
 * Ink-based multi-select (checkbox) prompt.
 *
 * Renders a list of options with checkboxes navigable with arrow keys,
 * toggleable with Space, and confirmable with Enter.
 * Falls back to readline when not in an interactive TTY.
 */

import React, { useState } from 'react';
import { render, Box, Text, useInput, useApp } from 'ink';
import { getOutputOptions } from '../utils/output.js';
import { readlineMultiSelect } from './readline-fallback.js';

// ── Types ──────────────────────────────────────────────────────────────

export interface MultiSelectOption<T extends string = string> {
  label: string;
  value: T;
  description?: string;
}

export interface MultiSelectConfig {
  title?: string;
  subtitle?: string;
}

// ── Ink component ──────────────────────────────────────────────────────

interface MultiSelectComponentProps {
  options: MultiSelectOption[];
  config?: MultiSelectConfig;
  onSelect: (values: string[]) => void;
  onCancel: () => void;
}

function MultiSelectComponent({
  options,
  config,
  onSelect,
  onCancel,
}: MultiSelectComponentProps) {
  const [index, setIndex] = useState(0);
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const app = useApp();

  useInput((input, key) => {
    if (key.upArrow) {
      setIndex((i) => (i - 1 + options.length) % options.length);
    }
    if (key.downArrow) {
      setIndex((i) => (i + 1) % options.length);
    }

    // Space: toggle checkbox at cursor
    if (input === ' ') {
      setChecked((prev) => {
        const next = new Set(prev);
        if (next.has(index)) {
          next.delete(index);
        } else {
          next.add(index);
        }
        return next;
      });
    }

    // 'a' key: toggle all / none
    if (input === 'a') {
      setChecked((prev) => {
        if (prev.size === options.length) {
          return new Set();
        }
        const all = new Set<number>();
        for (let i = 0; i < options.length; i++) all.add(i);
        return all;
      });
    }

    if (key.return) {
      const selected = [...checked].sort((a, b) => a - b).map((i) => options[i].value);
      onSelect(selected);
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

      {options.map((opt, i) => {
        const isChecked = checked.has(i);
        const isCursor = i === index;

        return (
          <Box key={opt.value} flexDirection="column">
            <Box>
              <Text color={isCursor ? 'green' : 'gray'}>
                {isCursor ? '> ' : '  '}
              </Text>
              <Text color={isChecked ? 'green' : 'gray'}>
                {isChecked ? '[x] ' : '[ ] '}
              </Text>
              <Text bold={isCursor} color={isCursor ? 'green' : 'white'}>
                {opt.label}
              </Text>
            </Box>
            {opt.description && (
              <Box marginLeft={6}>
                <Text color="gray">{opt.description}</Text>
              </Box>
            )}
          </Box>
        );
      })}

      <Box marginTop={1}>
        <Text color="gray" dimColor>
          Arrow keys to move, Space to toggle, 'a' to toggle all, Enter to confirm, Esc to cancel
        </Text>
      </Box>
    </Box>
  );
}

// ── Public API ─────────────────────────────────────────────────────────

/**
 * Show an interactive multi-select (checkbox) prompt.
 *
 * Returns an array of selected values, or an empty array if cancelled.
 * Falls back to readline-based multi-select when not interactive.
 */
export async function inkMultiSelect<T extends string>(
  options: MultiSelectOption<T>[],
  config?: MultiSelectConfig,
): Promise<T[]> {
  const opts = getOutputOptions();
  const interactive = !opts.json && !opts.quiet && process.stderr.isTTY !== false;

  if (!interactive) {
    return readlineMultiSelect(options, config);
  }

  let result: T[] = [];

  const { waitUntilExit } = render(
    React.createElement(MultiSelectComponent, {
      options: options as MultiSelectOption[],
      config,
      onSelect: (values: string[]) => {
        result = values as T[];
      },
      onCancel: () => {
        result = [];
      },
    }),
    { stdout: process.stderr },
  );

  await waitUntilExit();
  return result;
}
