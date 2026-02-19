/**
 * Pin generator functions for PCB component chips.
 *
 * Produces gull-wing QFP, bottom gull-wing, and top decorative pins
 * as arrays of SVG elements.
 */

const PAD_W = 3.5;
const PAD_L = 4;
const LEAD_W = 1;
const GULL_DROP = 2.5;

/** Vertical extension from body bottom to gull-wing tip */
export const PIN_EXT_Y = PAD_L + 8; // 12px
/** Horizontal offset of gull-wing tip from pad center */
export const PIN_EXT_X = GULL_DROP * 0.5; // 1.25px

/** Gull-wing QFP pins on left and right sides */
export function qfpPins(
  ic: { x: number; y: number; w: number; h: number },
  sideCount: number,
  padColor: string,
  pinColor: string,
): React.JSX.Element[] {
  const els: React.JSX.Element[] = [];
  const spacing = (ic.h - 12) / Math.max(sideCount - 1, 1);
  for (let i = 0; i < sideCount; i++) {
    const py = ic.y + 6 + i * spacing;
    els.push(
      <g key={`l${i}`}>
        <rect x={ic.x - PAD_L} y={py - PAD_W / 2} width={PAD_L} height={PAD_W} fill={padColor} rx={0.5} />
        <path
          d={`M ${ic.x - PAD_L - 7} ${py - GULL_DROP} L ${ic.x - PAD_L - 3} ${py - GULL_DROP} L ${ic.x - PAD_L - 1} ${py} L ${ic.x - PAD_L} ${py}`}
          stroke={pinColor} strokeWidth={LEAD_W} fill="none" strokeLinejoin="round"
        />
      </g>,
    );
    els.push(
      <g key={`r${i}`}>
        <rect x={ic.x + ic.w} y={py - PAD_W / 2} width={PAD_L} height={PAD_W} fill={padColor} rx={0.5} />
        <path
          d={`M ${ic.x + ic.w + PAD_L} ${py} L ${ic.x + ic.w + PAD_L + 1} ${py} L ${ic.x + ic.w + PAD_L + 3} ${py - GULL_DROP} L ${ic.x + ic.w + PAD_L + 7} ${py - GULL_DROP}`}
          stroke={pinColor} strokeWidth={LEAD_W} fill="none" strokeLinejoin="round"
        />
      </g>,
    );
  }
  return els;
}

/** Bottom gull-wing pins (connect down to handle) */
export function bottomGullPins(
  x: number, y: number, w: number, count: number,
  padColor: string, pinColor: string,
): React.JSX.Element[] {
  const els: React.JSX.Element[] = [];
  const margin = 12;
  const spacing = (w - margin * 2) / Math.max(count - 1, 1);
  for (let i = 0; i < count; i++) {
    const px = x + margin + i * spacing;
    els.push(
      <g key={`bp${i}`}>
        <rect x={px - PAD_W / 2} y={y} width={PAD_W} height={PAD_L} fill={padColor} rx={0.5} />
        <path
          d={`M ${px} ${y + PAD_L} L ${px} ${y + PAD_L + 2} L ${px + GULL_DROP * 0.5} ${y + PAD_L + 5} L ${px + GULL_DROP * 0.5} ${y + PAD_L + 8}`}
          stroke={pinColor} strokeWidth={LEAD_W} fill="none" strokeLinejoin="round"
        />
      </g>,
    );
  }
  return els;
}

/** Connection pads at allocated handle positions (gold pad + gull-wing lead) */
export function connectionPads(
  offsets: number[],
  y: number,
  padColor: string,
  pinColor: string,
): React.JSX.Element[] {
  return offsets.map((px, i) => (
    <g key={`cp-${i}`}>
      <rect x={px - PAD_W / 2} y={y} width={PAD_W} height={PAD_L} fill={padColor} rx={0.5} />
      <path
        d={`M ${px} ${y + PAD_L} L ${px} ${y + PAD_L + 2} L ${px + GULL_DROP * 0.5} ${y + PAD_L + 5} L ${px + GULL_DROP * 0.5} ${y + PAD_L + 8}`}
        stroke={pinColor} strokeWidth={LEAD_W} fill="none" strokeLinejoin="round"
      />
    </g>
  ));
}

/** Top pins (shorter, decorative) */
export function topPins(
  x: number, y: number, w: number, count: number,
  padColor: string, pinColor: string,
): React.JSX.Element[] {
  const els: React.JSX.Element[] = [];
  const margin = 12;
  const spacing = (w - margin * 2) / Math.max(count - 1, 1);
  for (let i = 0; i < count; i++) {
    const px = x + margin + i * spacing;
    els.push(
      <g key={`tp${i}`}>
        <rect x={px - PAD_W / 2} y={y - PAD_L} width={PAD_W} height={PAD_L} fill={padColor} rx={0.5} />
        <line x1={px} y1={y - PAD_L - 4} x2={px} y2={y - PAD_L}
          stroke={pinColor} strokeWidth={LEAD_W} />
      </g>,
    );
  }
  return els;
}
