/**
 * Summary component shown after wizard completion
 */

import React from 'react';
import { Box, Text } from 'ink';
import type { WizardContext } from '../types';

interface SummaryProps {
  success: boolean;
  context: WizardContext;
}

export function Summary({ success, context }: SummaryProps) {
  if (!success) {
    return (
      <Box flexDirection="column" marginTop={1}>
        <Text color="red" bold>
          Setup failed!
        </Text>
        <Text color="gray">Please check the error above and try again.</Text>
      </Box>
    );
  }

  const presetName = context.preset?.name || 'application';
  const agentUsername = context.agentUser?.username || 'agenshield_agent';

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text color="green" bold>
        ✓ Setup complete!
      </Text>
      <Box marginTop={1} flexDirection="column">
        <Text color="gray">{presetName} is now running in an isolated sandbox.</Text>
        <Text> </Text>
        <Text color="cyan">Details:</Text>
        <Box marginLeft={2} flexDirection="column">
          <Text>
            • User: <Text color="yellow">{context.agentUser?.username}</Text>
          </Text>
          <Text>
            • Home: <Text color="yellow">{context.agentUser?.homeDir}</Text>
          </Text>
          {context.migration?.newPaths && (
            <>
              <Text>
                • Binary: <Text color="yellow">{context.migration.newPaths.binaryPath}</Text>
              </Text>
              <Text>
                • Config: <Text color="yellow">{context.migration.newPaths.configPath}</Text>
              </Text>
            </>
          )}
        </Box>
        <Text> </Text>
        <Text color="gray">Run as sandboxed user:</Text>
        <Text color="cyan"> sudo -u {agentUsername} {context.migration?.newPaths?.binaryPath || 'agent'}</Text>
      </Box>
    </Box>
  );
}
