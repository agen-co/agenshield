/**
 * ShieldChipNode — inline shield chip between the bus and an application card.
 *
 * Small IC package (80x40) with gull-wing pins and shield icon.
 * Orientation depends on `data.side`:
 *   - left side: bus-side=Right, app-side=Left
 *   - right side: bus-side=Left, app-side=Right
 */

import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Shield } from 'lucide-react';
import { useTheme } from '@mui/material/styles';
import { pcb } from '../../styles/pcb-tokens';
import type { ShieldChipData } from '../../Canvas.types';

/* ---- Dimensions ---- */
const CHIP_W = 80;
const CHIP_H = 40;
const BODY_X = 10; // pin overhang on each side
const BODY_Y = 5;
const BODY_W = 60;
const BODY_H = 30;

/* ---- Status LED colors ---- */
const LED_MAP: Record<string, string> = {
  inactive: pcb.component.ledOff,
  activating: pcb.component.ledAmber,
  active: pcb.component.ledGreen,
};

export const ShieldChipNode = memo(({ data }: NodeProps) => {
  const { status, side } = data as unknown as ShieldChipData;

  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';

  const chipBody = isDark ? pcb.component.body : '#D8D8D0';
  const chipBorder = isDark ? 'rgba(80,80,80,0.3)' : 'rgba(80,80,80,0.2)';
  const silkColor = isDark ? pcb.silk.primary : pcb.light.silk;
  const silkDim = isDark ? pcb.silk.dim : '#6A6A5A';
  const padColor = pcb.component.padGold;
  const ledColor = LED_MAP[status] ?? pcb.component.ledOff;
  const isActive = status === 'active';
  const isActivating = status === 'activating';

  /* ---- Pin positions (4 gull-wing pins on each side) ---- */
  const pinYs = [BODY_Y + 4, BODY_Y + 10, BODY_Y + 20, BODY_Y + 26];

  return (
    <div style={{ position: 'relative', cursor: 'default' }}>
      {/* Handles depend on side orientation */}
      {side === 'left' ? (
        <>
          <Handle type="target" position={Position.Right} id="bus-side"
            style={{ top: CHIP_H / 2, visibility: 'hidden' }} />
          <Handle type="source" position={Position.Left} id="app-side"
            style={{ top: CHIP_H / 2, visibility: 'hidden' }} />
        </>
      ) : (
        <>
          <Handle type="target" position={Position.Left} id="bus-side"
            style={{ top: CHIP_H / 2, visibility: 'hidden' }} />
          <Handle type="source" position={Position.Right} id="app-side"
            style={{ top: CHIP_H / 2, visibility: 'hidden' }} />
        </>
      )}

      <svg
        width={CHIP_W}
        height={CHIP_H}
        viewBox={`0 0 ${CHIP_W} ${CHIP_H}`}
        style={{ display: 'block', overflow: 'visible' }}
      >
        {/* === Active glow === */}
        {isActive && (
          <rect
            x={BODY_X - 4} y={BODY_Y - 4}
            width={BODY_W + 8} height={BODY_H + 8}
            fill={pcb.component.ledGreen} rx={6} opacity={0.08}
            style={{ animation: 'pcb-led-glow-breathe 2s ease-in-out infinite' }}
          />
        )}

        {/* === Chip body === */}
        <rect
          x={BODY_X} y={BODY_Y} width={BODY_W} height={BODY_H}
          fill={chipBody} stroke={chipBorder} strokeWidth={0.5} rx={2}
        />
        <rect
          x={BODY_X} y={BODY_Y} width={BODY_W} height={BODY_H}
          fill="url(#pcb-chip-gradient)" rx={2} opacity={0.4}
        />

        {/* === Left gull-wing pins === */}
        {pinYs.map((py, i) => (
          <g key={`lp-${i}`}>
            <rect x={BODY_X - 3} y={py - 1} width={3} height={2.5} fill={padColor} rx={0.3} />
            <path
              d={`M ${BODY_X - 3} ${py + 0.25} H ${BODY_X - 7} V ${py + 2} H ${BODY_X - 10}`}
              fill="none" stroke={padColor} strokeWidth={0.8}
            />
          </g>
        ))}

        {/* === Right gull-wing pins === */}
        {pinYs.map((py, i) => (
          <g key={`rp-${i}`}>
            <rect x={BODY_X + BODY_W} y={py - 1} width={3} height={2.5} fill={padColor} rx={0.3} />
            <path
              d={`M ${BODY_X + BODY_W + 3} ${py + 0.25} H ${BODY_X + BODY_W + 7} V ${py + 2} H ${BODY_X + BODY_W + 10}`}
              fill="none" stroke={padColor} strokeWidth={0.8}
            />
          </g>
        ))}

        {/* === Pin-1 dot === */}
        <circle cx={BODY_X + 4} cy={BODY_Y + 4} r={1.5} fill={silkDim} opacity={0.5} />

        {/* === Shield icon === */}
        <foreignObject x={BODY_X + BODY_W / 2 - 8} y={BODY_Y + 2} width={16} height={16}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
            <Shield
              size={14}
              color={isActive ? pcb.component.ledGreen : isDark ? pcb.trace.bright : '#555'}
            />
          </div>
        </foreignObject>

        {/* === "SHIELD" label === */}
        <text
          x={BODY_X + BODY_W / 2} y={BODY_Y + BODY_H - 5}
          textAnchor="middle" dominantBaseline="central"
          fill={silkColor} fontSize={5.5}
          fontFamily="'IBM Plex Mono', monospace"
          fontWeight={700} letterSpacing={0.8}
        >
          SHIELD
        </text>

        {/* === Status LED === */}
        <g>
          <circle
            cx={BODY_X + BODY_W - 6} cy={BODY_Y + 6} r={isActive ? 5 : 3}
            fill={ledColor} opacity={isActive ? 0.25 : 0.08}
            style={isActive || isActivating
              ? { animation: 'pcb-led-glow-breathe 2s ease-in-out infinite' }
              : undefined}
          />
          <rect
            x={BODY_X + BODY_W - 9} y={BODY_Y + 4.5} width={6} height={3}
            fill={isDark ? pcb.component.bodyLight : '#e0e0d8'}
            stroke={chipBorder} strokeWidth={0.3} rx={0.5}
          />
          <rect
            x={BODY_X + BODY_W - 8} y={BODY_Y + 5} width={4} height={2}
            fill={ledColor} rx={0.5} opacity={isActive ? 0.9 : 0.25}
            style={isActive
              ? { animation: 'pcb-led-pulse 2s ease-in-out infinite' }
              : isActivating
                ? { animation: 'pcb-led-blink 0.8s ease-in-out infinite' }
                : undefined}
          />
        </g>

        {/* === Ref designator === */}
        <text
          x={BODY_X + BODY_W - 3} y={BODY_Y - 2}
          textAnchor="end" fill={silkDim} fontSize={3.5}
          fontFamily="'IBM Plex Mono', monospace" opacity={0.5}
        >
          U6
        </text>
      </svg>
    </div>
  );
});
ShieldChipNode.displayName = 'ShieldChipNode';
