/**
 * Confirmation component for user confirmation prompts
 */

import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import type { OpenClawInstallation } from '@agenshield/sandbox';

interface UserNames {
  agentUser: string;
  brokerUser: string;
  socketGroup: string;
  workspaceGroup: string;
}

interface ConfirmProps {
  installation: OpenClawInstallation;
  presetName?: string;
  userNames?: UserNames;
  onConfirm: () => void;
  onCancel: () => void;
}

export function Confirm({ installation, presetName, userNames, onConfirm, onCancel }: ConfirmProps) {
  const targetName = presetName || 'OpenClaw';
  const agentUser = userNames?.agentUser || 'ash_default_agent';
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
          {targetName} found: v{installation.version || 'unknown'} ({installation.method})
        </Text>
        <Text color="gray">Location: {installation.packagePath}</Text>
        {installation.configPath && (
          <Text color="gray">Config: {installation.configPath}</Text>
        )}
      </Box>

      <Box flexDirection="column" marginTop={1}>
        <Text bold>This will:</Text>
        <Box marginLeft={2} flexDirection="column">
          <Text color="yellow">→ Create sandbox user "{agentUser}"</Text>
          <Text color="yellow">→ Move {targetName} to sandbox user home</Text>
          <Text color="yellow">→ Install guarded shell for isolation</Text>
          <Text color="yellow">→ Protect your secrets from skills</Text>
        </Box>
      </Box>

      {userNames && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold>Users and Groups:</Text>
          <Box marginLeft={2} flexDirection="column">
            <Text color="cyan">Agent user:      {userNames.agentUser}</Text>
            <Text color="cyan">Broker user:     {userNames.brokerUser}</Text>
            <Text color="cyan">Socket group:    {userNames.socketGroup}</Text>
            <Text color="cyan">Workspace group: {userNames.workspaceGroup}</Text>
          </Box>
        </Box>
      )}

      <Box flexDirection="column" marginTop={1}>
        <Text color="gray">Original installation will be backed up.</Text>
        <Text color="gray">
          You can reverse this with: <Text color="cyan">agenshield uninstall</Text>
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

/**
 * Uninstall confirmation component that requires typing "UNINSTALL"
 */
interface UninstallConfirmProps {
  backupTimestamp: string;
  sandboxUsername: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function UninstallConfirm({
  backupTimestamp,
  sandboxUsername,
  onConfirm,
  onCancel,
}: UninstallConfirmProps) {
  const [input, setInput] = useState('');
  const CONFIRM_WORD = 'UNINSTALL';

  useInput((char, key) => {
    if (key.escape) {
      onCancel();
      return;
    }

    if (key.return) {
      if (input === CONFIRM_WORD) {
        onConfirm();
      }
      return;
    }

    if (key.backspace || key.delete) {
      setInput(input.slice(0, -1));
      return;
    }

    // Only allow alphanumeric characters
    if (char && /^[a-zA-Z]$/.test(char)) {
      setInput(input + char.toUpperCase());
    }
  });

  const isComplete = input === CONFIRM_WORD;

  return (
    <Box flexDirection="column" marginTop={1}>
      <Box flexDirection="column" borderStyle="round" borderColor="red" padding={1}>
        <Text bold color="red">
          AgenShield Uninstall
        </Text>
      </Box>

      <Box flexDirection="column" marginTop={1}>
        <Text bold>This will:</Text>
        <Box marginLeft={2} flexDirection="column">
          <Text color="yellow">→ Stop and remove agenshield daemon</Text>
          <Text color="yellow">→ Restore OpenClaw to original location</Text>
          <Text color="yellow">→ Delete sandbox user "{sandboxUsername}"</Text>
          <Text color="yellow">→ Remove guarded shell</Text>
          <Text color="yellow">→ Delete /etc/agenshield configuration</Text>
        </Box>
      </Box>

      <Box marginTop={1}>
        <Text color="gray">Backup found: {backupTimestamp}</Text>
      </Box>

      <Box marginTop={1} flexDirection="column">
        <Text bold color="red">
          WARNING: This cannot be fully reversed automatically!
        </Text>
      </Box>

      <Box marginTop={1} flexDirection="column">
        <Text>
          Type <Text bold color="red">UNINSTALL</Text> to confirm:{' '}
        </Text>
        <Box>
          <Text color={isComplete ? 'green' : 'yellow'}>{input}</Text>
          <Text color="gray" dimColor>
            {'_'.repeat(Math.max(0, CONFIRM_WORD.length - input.length))}
          </Text>
        </Box>
      </Box>

      {isComplete && (
        <Box marginTop={1}>
          <Text color="green">Press Enter to proceed with uninstall...</Text>
        </Box>
      )}

      <Box marginTop={1}>
        <Text color="gray" dimColor>
          Press Esc to cancel
        </Text>
      </Box>
    </Box>
  );
}
