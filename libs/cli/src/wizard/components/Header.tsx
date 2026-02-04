/**
 * Wizard header component
 */

import React from 'react';
import { Box, Text } from 'ink';

export function Header() {
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text bold color="cyan">
        🛡️ AgenShield Setup Wizard
      </Text>
      <Text color="gray">Isolating OpenClaw for secure operation</Text>
    </Box>
  );
}
