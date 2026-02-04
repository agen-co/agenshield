/**
 * Passcode setup component for the wizard
 *
 * Allows users to set a passcode during initial setup.
 * Users can also skip this step.
 */

import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';

type PasscodePhase = 'prompt' | 'enter' | 'confirm' | 'done';

interface PasscodeSetupProps {
  /** Called when user sets a passcode */
  onSetPasscode: (passcode: string) => void;
  /** Called when user skips passcode setup */
  onSkip: () => void;
}

export function PasscodeSetup({ onSetPasscode, onSkip }: PasscodeSetupProps) {
  const [phase, setPhase] = useState<PasscodePhase>('prompt');
  const [selected, setSelected] = useState<'yes' | 'no'>('yes');
  const [passcode, setPasscode] = useState('');
  const [confirmPasscode, setConfirmPasscode] = useState('');
  const [error, setError] = useState<string | null>(null);

  useInput((input, key) => {
    if (key.escape) {
      onSkip();
      return;
    }

    if (phase === 'prompt') {
      if (key.leftArrow || key.rightArrow) {
        setSelected(selected === 'yes' ? 'no' : 'yes');
      } else if (input === 'y') {
        setSelected('yes');
      } else if (input === 'n') {
        setSelected('no');
      }

      if (key.return) {
        if (selected === 'yes') {
          setPhase('enter');
        } else {
          onSkip();
        }
      }
      return;
    }

    if (phase === 'enter') {
      if (key.return) {
        if (passcode.length < 4) {
          setError('Passcode must be at least 4 characters');
          return;
        }
        setError(null);
        setPhase('confirm');
        return;
      }

      if (key.backspace || key.delete) {
        setPasscode(passcode.slice(0, -1));
        setError(null);
        return;
      }

      if (input && input.length === 1) {
        setPasscode(passcode + input);
        setError(null);
      }
      return;
    }

    if (phase === 'confirm') {
      if (key.return) {
        if (confirmPasscode !== passcode) {
          setError('Passcodes do not match. Try again.');
          setConfirmPasscode('');
          setPhase('enter');
          setPasscode('');
          return;
        }
        setPhase('done');
        onSetPasscode(passcode);
        return;
      }

      if (key.backspace || key.delete) {
        setConfirmPasscode(confirmPasscode.slice(0, -1));
        setError(null);
        return;
      }

      if (input && input.length === 1) {
        setConfirmPasscode(confirmPasscode + input);
        setError(null);
      }
      return;
    }
  });

  return (
    <Box flexDirection="column" marginTop={1}>
      <Box flexDirection="column" borderStyle="round" borderColor="cyan" padding={1}>
        <Text bold color="cyan">
          Passcode Protection
        </Text>
        <Text color="gray">
          Set a passcode to protect sensitive configuration (skills, policies, secrets).
        </Text>
      </Box>

      {phase === 'prompt' && (
        <Box flexDirection="column" marginTop={1}>
          <Text>Would you like to set a passcode? </Text>
          <Box marginTop={1}>
            <Text
              color={selected === 'yes' ? 'green' : 'gray'}
              bold={selected === 'yes'}
            >
              [Y]es
            </Text>
            <Text> / </Text>
            <Text
              color={selected === 'no' ? 'yellow' : 'gray'}
              bold={selected === 'no'}
            >
              [N]o, skip
            </Text>
          </Box>
          <Box marginTop={1}>
            <Text color="gray" dimColor>
              Press Y/N or arrow keys to select, Enter to confirm, Esc to skip
            </Text>
          </Box>
        </Box>
      )}

      {phase === 'enter' && (
        <Box flexDirection="column" marginTop={1}>
          <Text>Enter passcode (min 4 characters):</Text>
          <Box marginTop={1}>
            <Text color="cyan">{'*'.repeat(passcode.length)}</Text>
            <Text color="gray" dimColor>_</Text>
          </Box>
          {error && (
            <Box marginTop={1}>
              <Text color="red">{error}</Text>
            </Box>
          )}
          <Box marginTop={1}>
            <Text color="gray" dimColor>
              Press Enter when done, Esc to skip
            </Text>
          </Box>
        </Box>
      )}

      {phase === 'confirm' && (
        <Box flexDirection="column" marginTop={1}>
          <Text>Confirm passcode:</Text>
          <Box marginTop={1}>
            <Text color="cyan">{'*'.repeat(confirmPasscode.length)}</Text>
            <Text color="gray" dimColor>_</Text>
          </Box>
          {error && (
            <Box marginTop={1}>
              <Text color="red">{error}</Text>
            </Box>
          )}
          <Box marginTop={1}>
            <Text color="gray" dimColor>
              Press Enter when done, Esc to skip
            </Text>
          </Box>
        </Box>
      )}

      {phase === 'done' && (
        <Box marginTop={1}>
          <Text color="green">Passcode set successfully. Configuring protection...</Text>
        </Box>
      )}
    </Box>
  );
}
