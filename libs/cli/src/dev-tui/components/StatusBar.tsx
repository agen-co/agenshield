/**
 * StatusBar component - shows daemon status, agent user info, and connection state.
 */

import React from 'react';
import { Box, Text } from 'ink';
import type { DaemonStatus } from '../../utils/daemon.js';

interface StatusBarProps {
  daemonStatus: DaemonStatus;
  agentUsername: string;
  prefix: string;
}

export function StatusBar({ daemonStatus, agentUsername, prefix }: StatusBarProps) {
  const statusDot = daemonStatus.running ? '●' : '○';
  const statusColor = daemonStatus.running ? 'green' : 'red';
  const statusLabel = daemonStatus.running ? 'Running' : 'Stopped';

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1}>
        <Text bold color="cyan">
          AgenShield Dev Mode
        </Text>
        <Box marginTop={1}>
          <Text>
            Daemon: <Text color={statusColor}>{statusDot} {statusLabel}</Text>
            {daemonStatus.port && <Text color="gray"> (port {daemonStatus.port})</Text>}
            {daemonStatus.uptime && <Text color="gray"> uptime: {daemonStatus.uptime}</Text>}
          </Text>
        </Box>
        <Box>
          <Text>
            Agent:  <Text color="yellow">{agentUsername}</Text>
            <Text color="gray"> (prefix: {prefix})</Text>
          </Text>
        </Box>
      </Box>
    </Box>
  );
}
