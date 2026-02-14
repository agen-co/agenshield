/**
 * Self-updating "X ago" component that uses direct DOM mutation
 * to avoid re-rendering parent components.
 */

import { memo, useRef, useEffect } from 'react';
import { EventTime } from './ActivityPanel.styles';

function formatTimeAgo(ms: number): string {
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.floor(hr / 24);
  return `${d}d ago`;
}

function getUpdateInterval(ageMs: number): number {
  if (ageMs < 60_000) return 1000;       // every 1s when < 1 min
  if (ageMs < 3_600_000) return 30_000;  // every 30s when < 1 hour
  return 300_000;                         // every 5 min otherwise
}

export const TimeAgo = memo(function TimeAgo({ timestamp }: { timestamp: number }) {
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    let intervalId: ReturnType<typeof setInterval>;

    const schedule = () => {
      const age = Date.now() - timestamp;
      const interval = getUpdateInterval(age);

      intervalId = setInterval(() => {
        if (ref.current) {
          ref.current.textContent = formatTimeAgo(Date.now() - timestamp);
        }
        // Re-schedule if interval bracket changed
        clearInterval(intervalId);
        schedule();
      }, interval);
    };

    schedule();
    return () => clearInterval(intervalId);
  }, [timestamp]);

  return (
    <EventTime>
      <span ref={ref}>{formatTimeAgo(Date.now() - timestamp)}</span>
    </EventTime>
  );
});
