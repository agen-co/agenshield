import { pcb } from '../../../styles/pcb-tokens';

/** Color for a percentage gauge: green → amber → red */
export function gaugeColor(pct: number): string {
  if (pct < 50) return pcb.component.ledGreen;
  if (pct < 80) return pcb.component.ledAmber;
  return pcb.component.ledRed;
}

/** Format bytes/s to human-readable */
export function formatRate(bytesPerSec: number): string {
  if (bytesPerSec < 1024) return `${Math.round(bytesPerSec)}B`;
  if (bytesPerSec < 1024 * 1024) return `${(bytesPerSec / 1024).toFixed(1)}K`;
  return `${(bytesPerSec / (1024 * 1024)).toFixed(1)}M`;
}
