/**
 * LogViewer component - shows tail of daemon logs.
 */

import React from 'react';
import { Box, Text } from 'ink';

interface LogViewerProps {
  lines: string[];
  onBack: () => void;
}

export function LogViewer({ lines, onBack }: LogViewerProps) {
  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold color="cyan">Daemon Logs</Text>
        <Text color="gray"> (last {lines.length} lines)</Text>
      </Box>
      <Box flexDirection="column" borderStyle="single" borderColor="gray" paddingX={1}>
        {lines.length === 0 ? (
          <Text color="gray">No log entries found.</Text>
        ) : (
          lines.map((line, i) => (
            <Text key={i} color="gray">{line}</Text>
          ))
        )}
      </Box>
      <Box marginTop={1}>
        <Text color="gray" dimColor>Press Enter or Esc to go back</Text>
      </Box>
    </Box>
  );
}
