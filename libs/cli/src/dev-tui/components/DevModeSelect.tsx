/**
 * Dev mode selection component - Quick vs Custom naming vs Web UI
 */

import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { ASH_PREFIX, DEFAULT_BASE_NAME } from '@agenshield/sandbox';

export type DevSetupMode = 'quick' | 'advanced' | 'webui';

const DEV_PREFIX = 'dev';
const DEFAULT_AGENT = `${DEV_PREFIX}_${ASH_PREFIX}${DEFAULT_BASE_NAME}_agent`;
const DEFAULT_BROKER = `${DEV_PREFIX}_${ASH_PREFIX}${DEFAULT_BASE_NAME}_broker`;

interface DevModeSelectProps {
  onSelect: (mode: DevSetupMode) => void;
  onCancel: () => void;
}

const MODES: DevSetupMode[] = ['webui', 'quick', 'advanced'];

export function DevModeSelect({ onSelect, onCancel }: DevModeSelectProps) {
  const [selected, setSelected] = useState<DevSetupMode>('webui');

  useInput((input, key) => {
    if (key.upArrow || key.downArrow) {
      const idx = MODES.indexOf(selected);
      const next = key.downArrow
        ? (idx + 1) % MODES.length
        : (idx - 1 + MODES.length) % MODES.length;
      setSelected(MODES[next]);
    }

    if (input === '1' || input === 'w') {
      setSelected('webui');
    } else if (input === '2' || input === 'q') {
      setSelected('quick');
    } else if (input === '3' || input === 'a') {
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
        <Text color="gray">Choose how to set up your dev sandbox</Text>
      </Box>

      <Box flexDirection="column" marginTop={1}>
        <Box>
          <Text color={selected === 'webui' ? 'green' : 'gray'}>
            {selected === 'webui' ? '>' : ' '}
          </Text>
          <Text bold={selected === 'webui'} color={selected === 'webui' ? 'green' : 'white'}>
            [1] Web UI Setup
          </Text>
        </Box>
        <Box marginLeft={4}>
          <Text color="gray">
            Configure in browser (opens shield-ui)
          </Text>
        </Box>

        <Box marginTop={1}>
          <Text color={selected === 'quick' ? 'green' : 'gray'}>
            {selected === 'quick' ? '>' : ' '}
          </Text>
          <Text bold={selected === 'quick'} color={selected === 'quick' ? 'green' : 'white'}>
            [2] Quick Dev Setup
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
            [3] Custom Naming
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
          Press 1/2/3 or arrow keys to select, Enter to confirm, Esc to cancel
        </Text>
      </Box>
    </Box>
  );
}
