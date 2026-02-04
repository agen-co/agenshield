/**
 * Step list component showing wizard progress
 */

import React from 'react';
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import type { WizardStep } from '../types';

interface StepListProps {
  steps: WizardStep[];
  currentStep: number;
}

function StepIcon({ status }: { status: WizardStep['status'] }) {
  switch (status) {
    case 'completed':
      return <Text color="green">✓</Text>;
    case 'running':
      return (
        <Text color="cyan">
          <Spinner type="dots" />
        </Text>
      );
    case 'error':
      return <Text color="red">✗</Text>;
    case 'skipped':
      return <Text color="gray">-</Text>;
    default:
      return <Text color="gray">○</Text>;
  }
}

export function StepList({ steps, currentStep }: StepListProps) {
  return (
    <Box flexDirection="column" marginY={1}>
      {steps.map((step, index) => (
        <Box key={step.id} marginLeft={1}>
          <Box width={3}>
            <StepIcon status={step.status} />
          </Box>
          <Box flexDirection="column">
            <Text
              color={
                step.status === 'running'
                  ? 'cyan'
                  : step.status === 'completed'
                    ? 'green'
                    : step.status === 'error'
                      ? 'red'
                      : 'gray'
              }
              bold={step.status === 'running'}
            >
              {step.name}
            </Text>
            {step.status === 'running' && (
              <Text color="gray" dimColor>
                {step.description}
              </Text>
            )}
            {step.status === 'error' && step.error && (
              <Text color="red" dimColor>
                {step.error}
              </Text>
            )}
          </Box>
        </Box>
      ))}
    </Box>
  );
}
