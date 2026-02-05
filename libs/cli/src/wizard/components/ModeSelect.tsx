/**
 * Mode selection component - Quick vs Advanced setup
 */

import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { ASH_PREFIX, DEFAULT_BASE_NAME } from '@agenshield/sandbox';

export type SetupMode = 'quick' | 'advanced' | 'webui';

// Default names when using quick setup
const DEFAULT_AGENT = `${ASH_PREFIX}${DEFAULT_BASE_NAME}_agent`;
const DEFAULT_BROKER = `${ASH_PREFIX}${DEFAULT_BASE_NAME}_broker`;
const DEFAULT_SOCKET = `${ASH_PREFIX}${DEFAULT_BASE_NAME}`;
const DEFAULT_WORKSPACE = `${ASH_PREFIX}${DEFAULT_BASE_NAME}_workspace`;

interface ModeSelectProps {
  onSelect: (mode: SetupMode) => void;
  onCancel: () => void;
}

const MODES: SetupMode[] = ['quick', 'advanced', 'webui'];

export function ModeSelect({ onSelect, onCancel }: ModeSelectProps) {
  const [selected, setSelected] = useState<SetupMode>('quick');

  useInput((input, key) => {
    if (key.upArrow) {
      const idx = MODES.indexOf(selected);
      setSelected(MODES[(idx - 1 + MODES.length) % MODES.length]);
    }
    if (key.downArrow) {
      const idx = MODES.indexOf(selected);
      setSelected(MODES[(idx + 1) % MODES.length]);
    }

    if (input === '1' || input === 'q') {
      setSelected('quick');
    } else if (input === '2' || input === 'a') {
      setSelected('advanced');
    } else if (input === '3' || input === 'w') {
      setSelected('webui');
    }

    if (key.return) {
      onSelect(selected);
    }

    if (key.escape) {
      onCancel();
    }
  });

  return (
    <Box flexDirection="column" marginTop={1}>
      <Box flexDirection="column" borderStyle="round" borderColor="cyan" padding={1}>
        <Text bold color="cyan">
          Setup Mode
        </Text>
        <Text color="gray">Choose how you want to configure AgenShield</Text>
      </Box>

      <Box flexDirection="column" marginTop={1}>
        <Box>
          <Text color={selected === 'quick' ? 'green' : 'gray'}>
            {selected === 'quick' ? '>' : ' '}
          </Text>
          <Text bold={selected === 'quick'} color={selected === 'quick' ? 'green' : 'white'}>
            [1] Quick Setup
          </Text>
        </Box>
        <Box marginLeft={4}>
          <Text color="gray">
            Use default names: {DEFAULT_AGENT}, {DEFAULT_BROKER}, {DEFAULT_SOCKET}, {DEFAULT_WORKSPACE}
          </Text>
        </Box>

        <Box marginTop={1}>
          <Text color={selected === 'advanced' ? 'green' : 'gray'}>
            {selected === 'advanced' ? '>' : ' '}
          </Text>
          <Text bold={selected === 'advanced'} color={selected === 'advanced' ? 'green' : 'white'}>
            [2] Advanced Setup
          </Text>
        </Box>
        <Box marginLeft={4}>
          <Text color="gray">
            Customize user/group names (e.g., {ASH_PREFIX}myapp_agent)
          </Text>
        </Box>

        <Box marginTop={1}>
          <Text color={selected === 'webui' ? 'green' : 'gray'}>
            {selected === 'webui' ? '>' : ' '}
          </Text>
          <Text bold={selected === 'webui'} color={selected === 'webui' ? 'green' : 'white'}>
            [3] Web UI Setup
          </Text>
        </Box>
        <Box marginLeft={4}>
          <Text color="gray">
            Open setup wizard in your browser with live security visualization
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
