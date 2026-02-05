/**
 * ActionMenu component - interactive menu for selecting test actions.
 */

import React from 'react';
import { Box, Text } from 'ink';
import SelectInput from 'ink-select-input';
import type { ActionId } from '../runner.js';

interface ActionMenuItem {
  label: string;
  value: ActionId;
}

const MENU_ITEMS: ActionMenuItem[] = [
  { label: 'Test Network Access', value: 'test-network' },
  { label: 'Test File Read', value: 'test-file-read' },
  { label: 'Test File Write', value: 'test-file-write' },
  { label: 'Test Command Exec', value: 'test-exec' },
  { label: 'Show Sandbox Status', value: 'show-status' },
  { label: 'View Daemon Logs', value: 'view-logs' },
  { label: 'Quit', value: 'quit' },
];

interface ActionMenuProps {
  onSelect: (action: ActionId) => void;
}

export function ActionMenu({ onSelect }: ActionMenuProps) {
  const handleSelect = (item: ActionMenuItem) => {
    onSelect(item.value);
  };

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold color="cyan">Actions</Text>
      </Box>
      <SelectInput items={MENU_ITEMS} onSelect={handleSelect} />
    </Box>
  );
}
