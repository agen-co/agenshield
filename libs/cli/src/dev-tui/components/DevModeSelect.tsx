/**
 * Dev mode selection component - Quick vs Custom naming
 */

import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { ASH_PREFIX, DEFAULT_BASE_NAME } from '@agenshield/sandbox';

export type DevSetupMode = 'quick' | 'advanced';

const DEV_PREFIX = 'dev';
const DEFAULT_AGENT = `${DEV_PREFIX}_${ASH_PREFIX}${DEFAULT_BASE_NAME}_agent`;
const DEFAULT_BROKER = `${DEV_PREFIX}_${ASH_PREFIX}${DEFAULT_BASE_NAME}_broker`;

interface DevModeSelectProps {
  onSelect: (mode: DevSetupMode) => void;
  onCancel: () => void;
}

const MODES: DevSetupMode[] = ['quick', 'advanced'];

export function DevModeSelect({ onSelect, onCancel }: DevModeSelectProps) {
  const [selected, setSelected] = useState<DevSetupMode>('quick');

  useInput((input, key) => {
    if (key.upArrow || key.downArrow) {
      setSelected(selected === 'quick' ? 'advanced' : 'quick');
    }

    if (input === '1' || input === 'q') {
      setSelected('quick');
    } else if (input === '2' || input === 'a') {
      setSelected('advanced');
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
          Dev Setup Mode
        </Text>
        <Text color="gray">Choose how to name your dev sandbox users/groups</Text>
      </Box>

      <Box flexDirection="column" marginTop={1}>
        <Box>
          <Text color={selected === 'quick' ? 'green' : 'gray'}>
            {selected === 'quick' ? '>' : ' '}
          </Text>
          <Text bold={selected === 'quick'} color={selected === 'quick' ? 'green' : 'white'}>
            [1] Quick Dev Setup
          </Text>
        </Box>
        <Box marginLeft={4}>
          <Text color="gray">
            Use defaults: {DEFAULT_AGENT}, {DEFAULT_BROKER}
          </Text>
        </Box>

        <Box marginTop={1}>
          <Text color={selected === 'advanced' ? 'green' : 'gray'}>
            {selected === 'advanced' ? '>' : ' '}
          </Text>
          <Text bold={selected === 'advanced'} color={selected === 'advanced' ? 'green' : 'white'}>
            [2] Custom Naming
          </Text>
        </Box>
        <Box marginLeft={4}>
          <Text color="gray">
            Choose a base name (e.g., {DEV_PREFIX}_{ASH_PREFIX}myapp_agent)
          </Text>
        </Box>
      </Box>

      <Box marginTop={1}>
        <Text color="gray" dimColor>
          Press 1/2 or arrow keys to select, Enter to confirm, Esc to cancel
        </Text>
      </Box>
    </Box>
  );
}
