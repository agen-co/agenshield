/**
 * ActionResult component - displays the result of a test action.
 */

import React from 'react';
import { Box, Text } from 'ink';
import type { TestResult } from '../runner.js';

interface ActionResultProps {
  action: string;
  result: TestResult;
}

export function ActionResult({ action, result }: ActionResultProps) {
  const icon = result.success ? '✓' : '✗';
  const color = result.success ? 'green' : 'red';
  const label = result.success ? 'SUCCESS' : 'BLOCKED';

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box>
        <Text color={color} bold>
          {icon} {label}
        </Text>
        <Text color="gray"> — {action} ({result.duration}ms, exit {result.exitCode})</Text>
      </Box>
      {result.output && (
        <Box marginLeft={2} marginTop={0}>
          <Text color="gray">{result.output}</Text>
        </Box>
      )}
    </Box>
  );
}
