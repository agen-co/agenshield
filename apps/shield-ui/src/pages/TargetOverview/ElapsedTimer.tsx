/**
 * Self-updating elapsed timer that uses direct DOM mutation
 * to avoid re-rendering parent components.
 *
 * Follows the same pattern as TimeAgo (components/canvas/panels/ActivityPanel/TimeAgo.tsx).
 */

import { memo, useRef, useEffect } from 'react';
import { Typography } from '@mui/material';

function formatElapsed(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSec / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;

  const mm = String(minutes).padStart(2, '0');
  const ss = String(seconds).padStart(2, '0');

  if (hours > 0) {
    const hh = String(hours).padStart(2, '0');
    return `${hh}:${mm}:${ss}`;
  }
  return `${mm}:${ss}`;
}

export const ElapsedTimer = memo(function ElapsedTimer({ startedAtMs }: { startedAtMs: number }) {
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const update = () => {
      if (ref.current) {
        ref.current.textContent = formatElapsed(Date.now() - startedAtMs);
      }
    };

    update();
    const intervalId = setInterval(update, 1000);
    return () => clearInterval(intervalId);
  }, [startedAtMs]);

  return (
    <Typography
      component="span"
      variant="caption"
      color="text.secondary"
      sx={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 12 }}
    >
      <span ref={ref}>{formatElapsed(Date.now() - startedAtMs)}</span>
    </Typography>
  );
});
