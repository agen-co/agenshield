/**
 * Progress bar component
 */

import React from 'react';
import { Text } from 'ink';

interface ProgressBarProps {
  current: number;
  total: number;
  width?: number;
}

export function ProgressBar({ current, total, width = 40 }: ProgressBarProps) {
  const percent = total > 0 ? Math.round((current / total) * 100) : 0;
  const filled = Math.round((percent / 100) * width);
  const empty = width - filled;

  return (
    <Text>
      [<Text color="green">{'█'.repeat(filled)}</Text>
      <Text color="gray">{'░'.repeat(empty)}</Text>] {percent}%
    </Text>
  );
}
