/**
 * PathPrompt component - prompts user for file path or command input.
 */

import React, { useState } from 'react';
import { Box, Text } from 'ink';
import TextInput from 'ink-text-input';
import type { ActionId } from '../runner.js';

interface PathPromptProps {
  action: ActionId;
  onSubmit: (value: string) => void;
  onCancel: () => void;
}

function getPromptText(action: ActionId): string {
  switch (action) {
    case 'test-file-read':
      return 'File path to read';
    case 'test-file-write':
      return 'File path to write';
    case 'test-exec':
      return 'Command to execute';
    default:
      return 'Input';
  }
}

function getPlaceholder(action: ActionId): string {
  switch (action) {
    case 'test-file-read':
      return '/etc/passwd';
    case 'test-file-write':
      return '/tmp/test-write.txt';
    case 'test-exec':
      return 'whoami';
    default:
      return '';
  }
}

export function PathPrompt({ action, onSubmit, onCancel }: PathPromptProps) {
  const [value, setValue] = useState(getPlaceholder(action));

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold color="cyan">{getPromptText(action)}:</Text>
      </Box>
      <Box>
        <Text color="green">&gt; </Text>
        <TextInput
          value={value}
          onChange={setValue}
          onSubmit={(v) => {
            if (v.trim()) {
              onSubmit(v.trim());
            }
          }}
        />
      </Box>
      <Box marginTop={1}>
        <Text color="gray" dimColor>Enter to confirm, Esc to cancel</Text>
      </Box>
    </Box>
  );
}
