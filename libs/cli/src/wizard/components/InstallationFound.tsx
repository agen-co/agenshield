/**
 * Installation found component - Update vs Reinstall vs Cancel selection
 *
 * Shown when `agenshield setup` detects an existing installation.
 * Follows the same useInput + arrow key pattern as ModeSelect.tsx.
 */

import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';

export type InstallAction = 'update' | 'reinstall' | 'cancel';

interface InstallationFoundProps {
  onSelect: (action: InstallAction) => void;
  backupTimestamp?: string;
  installedVersion: string;
}

const ACTIONS: InstallAction[] = ['update', 'reinstall', 'cancel'];

export function InstallationFound({ onSelect, backupTimestamp, installedVersion }: InstallationFoundProps) {
  const [selected, setSelected] = useState<InstallAction>('update');

  useInput((input, key) => {
    if (key.upArrow) {
      const idx = ACTIONS.indexOf(selected);
      setSelected(ACTIONS[(idx - 1 + ACTIONS.length) % ACTIONS.length]);
    }
    if (key.downArrow) {
      const idx = ACTIONS.indexOf(selected);
      setSelected(ACTIONS[(idx + 1) % ACTIONS.length]);
    }

    if (input === '1' || input === 'u') {
      setSelected('update');
    } else if (input === '2' || input === 'r') {
      setSelected('reinstall');
    } else if (input === '3' || input === 'c') {
      setSelected('cancel');
    }

    if (key.return) {
      onSelect(selected);
    }

    if (key.escape) {
      onSelect('cancel');
    }
  });

  return (
    <Box flexDirection="column" marginTop={1}>
      <Box flexDirection="column" borderStyle="round" borderColor="cyan" padding={1}>
        <Text bold color="cyan">
          Existing Installation Found
        </Text>
        <Text color="gray">Installed version: {installedVersion}</Text>
        {backupTimestamp && <Text color="gray">Backup from: {backupTimestamp}</Text>}
      </Box>

      <Box flexDirection="column" marginTop={1}>
        <Box>
          <Text color={selected === 'update' ? 'green' : 'gray'}>
            {selected === 'update' ? '>' : ' '}
          </Text>
          <Text bold={selected === 'update'} color={selected === 'update' ? 'green' : 'white'}>
            [1] Update
          </Text>
        </Box>
        <Box marginLeft={4}>
          <Text color="gray">
            Non-destructive update — preserves users, data, and configs
          </Text>
        </Box>

        <Box marginTop={1}>
          <Text color={selected === 'reinstall' ? 'green' : 'gray'}>
            {selected === 'reinstall' ? '>' : ' '}
          </Text>
          <Text bold={selected === 'reinstall'} color={selected === 'reinstall' ? 'green' : 'white'}>
            [2] Reinstall
          </Text>
        </Box>
        <Box marginLeft={4}>
          <Text color="gray">
            Full uninstall + fresh setup (destructive)
          </Text>
        </Box>

        <Box marginTop={1}>
          <Text color={selected === 'cancel' ? 'green' : 'gray'}>
            {selected === 'cancel' ? '>' : ' '}
          </Text>
          <Text bold={selected === 'cancel'} color={selected === 'cancel' ? 'green' : 'white'}>
            [3] Cancel
          </Text>
        </Box>
        <Box marginLeft={4}>
          <Text color="gray">
            Exit without changes
          </Text>
        </Box>
      </Box>

      <Box marginTop={1}>
        <Text color="gray" dimColor>
          Press 1/2/3 or arrow keys to select, Enter to confirm, Esc to cancel
        </Text>
      </Box>
    </Box>
  );
}
