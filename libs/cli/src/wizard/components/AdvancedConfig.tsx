/**
 * Advanced configuration component for custom user/group naming
 */

import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import { ASH_PREFIX } from '@agenshield/sandbox';

/** Re-export for convenience */
export const REQUIRED_PREFIX = ASH_PREFIX;

export interface AdvancedConfigValues {
  /** Suffix for agent user (will become ash_{suffix}_agent) */
  agentSuffix: string;
  /** Suffix for broker user (will become ash_{suffix}_broker) */
  brokerSuffix: string;
  /** Suffix for socket group (will become ash_{suffix}) */
  socketGroupSuffix: string;
  /** Suffix for workspace group (will become ash_{suffix}_workspace) */
  workspaceGroupSuffix: string;
}

export interface ComputedNames {
  agentUser: string;
  brokerUser: string;
  socketGroup: string;
  workspaceGroup: string;
}

interface AdvancedConfigProps {
  /** Existing users/groups that would conflict */
  existingConflicts?: {
    users: string[];
    groups: string[];
  };
  onConfirm: (values: AdvancedConfigValues) => void;
  onCancel: () => void;
  onCheckConflicts: (names: ComputedNames) => Promise<{ users: string[]; groups: string[] }>;
}

type Field = 'baseName' | 'confirm';

/**
 * Compute the full names from a base name
 */
export function computeNames(baseName: string): ComputedNames {
  const clean = baseName.replace(/[^a-z0-9]/gi, '').toLowerCase();
  const base = clean || 'default';
  return {
    agentUser: `${REQUIRED_PREFIX}${base}_agent`,
    brokerUser: `${REQUIRED_PREFIX}${base}_broker`,
    socketGroup: `${REQUIRED_PREFIX}${base}`,
    workspaceGroup: `${REQUIRED_PREFIX}${base}_workspace`,
  };
}

export function AdvancedConfig({ existingConflicts, onConfirm, onCancel, onCheckConflicts }: AdvancedConfigProps) {
  const [baseName, setBaseName] = useState('');
  const [currentField, setCurrentField] = useState<Field>('baseName');
  const [conflicts, setConflicts] = useState<{ users: string[]; groups: string[] }>({ users: [], groups: [] });
  const [isChecking, setIsChecking] = useState(false);

  // Use provided conflicts or default to empty
  useEffect(() => {
    if (existingConflicts) {
      setConflicts(existingConflicts);
    }
  }, [existingConflicts]);

  const computedNames = computeNames(baseName);
  const hasConflicts = conflicts.users.length > 0 || conflicts.groups.length > 0;

  // Check for conflicts when baseName changes
  useEffect(() => {
    if (baseName.length > 0) {
      setIsChecking(true);
      const names = computeNames(baseName);
      onCheckConflicts(names).then((result) => {
        setConflicts(result);
        setIsChecking(false);
      }).catch(() => {
        setIsChecking(false);
      });
    } else {
      setConflicts({ users: [], groups: [] });
    }
  }, [baseName, onCheckConflicts]);

  useInput((input, key) => {
    if (key.escape) {
      onCancel();
      return;
    }

    if (currentField === 'baseName') {
      if (key.return) {
        if (baseName.length > 0 && !hasConflicts && !isChecking) {
          setCurrentField('confirm');
        }
        return;
      }

      if (key.backspace || key.delete) {
        setBaseName(baseName.slice(0, -1));
        return;
      }

      // Only allow alphanumeric characters
      if (input && /^[a-zA-Z0-9]$/.test(input)) {
        if (baseName.length < 20) {
          setBaseName(baseName + input.toLowerCase());
        }
      }
    } else if (currentField === 'confirm') {
      if (key.return && !hasConflicts) {
        onConfirm({
          agentSuffix: baseName,
          brokerSuffix: baseName,
          socketGroupSuffix: baseName,
          workspaceGroupSuffix: baseName,
        });
        return;
      }

      if (key.backspace || input === 'b') {
        setCurrentField('baseName');
        return;
      }
    }
  });

  return (
    <Box flexDirection="column" marginTop={1}>
      <Box flexDirection="column" borderStyle="round" borderColor="cyan" padding={1}>
        <Text bold color="cyan">
          Advanced Configuration
        </Text>
        <Text color="gray">
          Customize user and group names (ash_ prefix is required)
        </Text>
      </Box>

      <Box flexDirection="column" marginTop={1}>
        <Text bold>Enter a base name for users/groups:</Text>
        <Box marginTop={1}>
          <Text color="gray">{REQUIRED_PREFIX}</Text>
          <Text color={currentField === 'baseName' ? 'yellow' : 'white'}>
            {baseName || (currentField === 'baseName' ? '_' : '')}
          </Text>
          {currentField === 'baseName' && baseName.length > 0 && (
            <Text color="gray" dimColor>_</Text>
          )}
        </Box>
      </Box>

      {baseName.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold>Preview:</Text>
          <Box marginLeft={2} flexDirection="column">
            <Text color={conflicts.users.includes(computedNames.agentUser) ? 'red' : 'green'}>
              Agent user:     {computedNames.agentUser}
              {conflicts.users.includes(computedNames.agentUser) && ' (EXISTS!)'}
            </Text>
            <Text color={conflicts.users.includes(computedNames.brokerUser) ? 'red' : 'green'}>
              Broker user:    {computedNames.brokerUser}
              {conflicts.users.includes(computedNames.brokerUser) && ' (EXISTS!)'}
            </Text>
            <Text color={conflicts.groups.includes(computedNames.socketGroup) ? 'red' : 'green'}>
              Socket group:   {computedNames.socketGroup}
              {conflicts.groups.includes(computedNames.socketGroup) && ' (EXISTS!)'}
            </Text>
            <Text color={conflicts.groups.includes(computedNames.workspaceGroup) ? 'red' : 'green'}>
              Workspace group: {computedNames.workspaceGroup}
              {conflicts.groups.includes(computedNames.workspaceGroup) && ' (EXISTS!)'}
            </Text>
          </Box>
        </Box>
      )}

      {isChecking && (
        <Box marginTop={1}>
          <Text color="yellow">Checking for conflicts...</Text>
        </Box>
      )}

      {hasConflicts && !isChecking && (
        <Box flexDirection="column" marginTop={1} borderStyle="round" borderColor="red" padding={1}>
          <Text bold color="red">
            Cannot proceed - existing users/groups found!
          </Text>
          <Text color="gray">
            Please choose a different base name or remove the existing users/groups first.
          </Text>
        </Box>
      )}

      {currentField === 'confirm' && !hasConflicts && (
        <Box marginTop={1}>
          <Text color="green" bold>
            Press Enter to confirm, or B to go back
          </Text>
        </Box>
      )}

      <Box marginTop={1}>
        <Text color="gray" dimColor>
          {currentField === 'baseName'
            ? 'Type a name (letters/numbers only), Enter to continue, Esc to cancel'
            : 'Press Enter to confirm, B to go back, Esc to cancel'}
        </Text>
      </Box>
    </Box>
  );
}
