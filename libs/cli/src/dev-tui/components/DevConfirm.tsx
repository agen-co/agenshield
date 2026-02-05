/**
 * Dev-specific confirmation component
 */

import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';

interface UserNames {
  agentUser: string;
  brokerUser: string;
  socketGroup: string;
  workspaceGroup: string;
}

interface DevConfirmProps {
  userNames: UserNames;
  detectedTarget?: { name: string; version?: string } | null;
  onConfirm: () => void;
  onCancel: () => void;
}

export function DevConfirm({ userNames, detectedTarget, onConfirm, onCancel }: DevConfirmProps) {
  const [selected, setSelected] = useState<'yes' | 'no'>('yes');

  useInput((input, key) => {
    if (key.leftArrow || key.rightArrow || input === 'y' || input === 'n') {
      if (input === 'y') {
        setSelected('yes');
      } else if (input === 'n') {
        setSelected('no');
      } else {
        setSelected(selected === 'yes' ? 'no' : 'yes');
      }
    }

    if (key.return) {
      if (selected === 'yes') {
        onConfirm();
      } else {
        onCancel();
      }
    }

    if (key.escape) {
      onCancel();
    }
  });

  return (
    <Box flexDirection="column" marginTop={1}>
      <Box flexDirection="column" borderStyle="round" borderColor="cyan" padding={1}>
        <Text bold color="cyan">
          Dev Environment Setup
        </Text>
        {detectedTarget && (
          <Text color="gray">
            Detected: {detectedTarget.name}
            {detectedTarget.version ? ` v${detectedTarget.version}` : ''}
          </Text>
        )}
      </Box>

      <Box flexDirection="column" marginTop={1}>
        <Text bold>This will:</Text>
        <Box marginLeft={2} flexDirection="column">
          <Text color="yellow">→ Create dev sandbox users and groups</Text>
          <Text color="yellow">→ Create sandbox directories</Text>
          <Text color="yellow">→ Copy node binary to agent bin dir</Text>
          <Text color="yellow">→ Start the AgenShield daemon</Text>
        </Box>
      </Box>

      <Box flexDirection="column" marginTop={1}>
        <Text bold>Users and Groups:</Text>
        <Box marginLeft={2} flexDirection="column">
          <Text color="cyan">Agent user:      {userNames.agentUser}</Text>
          <Text color="cyan">Broker user:     {userNames.brokerUser}</Text>
          <Text color="cyan">Socket group:    {userNames.socketGroup}</Text>
          <Text color="cyan">Workspace group: {userNames.workspaceGroup}</Text>
        </Box>
      </Box>

      <Box flexDirection="column" marginTop={1}>
        <Text color="gray">
          Clean up with: <Text color="cyan">agenshield dev clean</Text>
        </Text>
      </Box>

      <Box marginTop={1}>
        <Text>Continue? </Text>
        <Text
          color={selected === 'yes' ? 'green' : 'gray'}
          bold={selected === 'yes'}
        >
          [Y]es
        </Text>
        <Text> / </Text>
        <Text
          color={selected === 'no' ? 'red' : 'gray'}
          bold={selected === 'no'}
        >
          [N]o
        </Text>
      </Box>

      <Box marginTop={1}>
        <Text color="gray" dimColor>
          Press Y/N or arrow keys to select, Enter to confirm, Esc to cancel
        </Text>
      </Box>
    </Box>
  );
}
