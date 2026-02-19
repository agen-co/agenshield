/**
 * BrokerNode — PCB broker frame wrapping a simplified application card.
 *
 * Outer frame: 232x152 with PCB-styled border, "ASH-BROKER" silkscreen, via pads.
 * Inner card:  200x120 showing app name, icon, status LED, type label.
 *
 * Handles:
 *   - top-bus: connects up to + bottom arm
 *   - danger handles for penetration/tendril wires
 */

import React, { memo, useCallback } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Terminal, Globe, Monitor, Cpu } from 'lucide-react';
import { useTheme } from '@mui/material/styles';
import { pcb } from '../../styles/pcb-tokens';
import type { BrokerCardData, HandleSpec } from '../../Canvas.types';
import { openDrilldown } from '../../../../state/canvas-drilldown';

/* ---- Dimensions ---- */
const BROKER_W = 232;
const BROKER_H = 152;
const PAD = 16;
const INNER_W = BROKER_W - PAD * 2;  // 200
const INNER_H = BROKER_H - PAD * 2;  // 120

const STATUS_LED: Record<string, string> = {
  unshielded: pcb.component.ledRed,
  shielding: pcb.component.ledAmber,
  shielded: pcb.component.ledGreen,
};

const ICON_MAP: Record<string, typeof Terminal> = {
  Terminal, Globe, Monitor, Cpu,
};

const BRAND_ICONS: Record<string, string> = {
  openclaw: '/icons/openclaw.svg',
  'claude-code': '/icons/claude-code.svg',
};

export const BrokerNode = memo(({ data }: NodeProps) => {
  const {
    id: cardId, name, type, icon, status, isRunning,
    handleOverrides: dangerHandles,
  } = data as unknown as BrokerCardData & { handleOverrides?: HandleSpec[] };

  const handleClick = useCallback(() => {
    openDrilldown(cardId);
  }, [cardId]);

  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';

  const bodyColor = isDark ? '#161820' : '#F2F2EE';
  const brokerBorder = isDark ? 'rgba(60,60,60,0.3)' : 'rgba(100,100,100,0.3)';
  const innerBg = isDark ? '#191B20' : '#E4E4DE';
  const innerBorder = isDark ? 'rgba(60,60,60,0.25)' : 'rgba(100,100,100,0.25)';
  const silkColor = isDark ? pcb.silk.primary : '#2A2A2A';
  const silkDim = isDark ? pcb.silk.dim : '#6A6A6A';
  const padColor = pcb.component.padGold;
  const ledColor = STATUS_LED[status] ?? pcb.component.ledRed;
  const Icon = ICON_MAP[icon] ?? Terminal;

  // Via pad positions (decorative corners)
  const vias = [
    { x: 8, y: 8 },
    { x: BROKER_W - 8, y: 8 },
    { x: 8, y: BROKER_H - 8 },
    { x: BROKER_W - 8, y: BROKER_H - 8 },
  ];

  return (
    <div style={{ position: 'relative', cursor: 'pointer' }} onClick={handleClick}>
      {/* === Top bus handle (connects to + bottom arm) === */}
      <Handle type="target" position={Position.Top} id="top-bus"
        style={{ left: BROKER_W / 2, visibility: 'hidden' }} />

      {/* === Danger wire handles — dynamic from pin allocator, or fallback === */}
      {(dangerHandles ?? [
        { id: 'danger-up', type: 'source' as const, position: Position.Top, offset: BROKER_W / 2 - 20 },
        { id: 'danger-up-in', type: 'target' as const, position: Position.Top, offset: BROKER_W / 2 + 20 },
        { id: 'danger-top-out', type: 'source' as const, position: Position.Top, offset: BROKER_W / 2 - 40 },
        { id: 'danger-bottom-in', type: 'target' as const, position: Position.Bottom, offset: BROKER_W / 2 },
      ]).map((spec) => (
        <Handle key={spec.id} type={spec.type} position={spec.position} id={spec.id}
          style={{
            ...(spec.position === Position.Top || spec.position === Position.Bottom
              ? { left: spec.offset ?? BROKER_W / 2 }
              : { top: spec.offset ?? BROKER_H / 2 }),
            ...(spec.position === Position.Right ? { left: BROKER_W } : {}),
            visibility: 'hidden',
          }} />
      ))}

      <svg width={BROKER_W} height={BROKER_H} viewBox={`0 0 ${BROKER_W} ${BROKER_H}`}
        style={{ display: 'block', overflow: 'visible' }}>

        {/* === Outer broker frame === */}
        <rect x={0} y={0} width={BROKER_W} height={BROKER_H}
          fill={bodyColor} stroke={brokerBorder} strokeWidth={1.2} rx={4} />
        <rect x={0} y={0} width={BROKER_W} height={BROKER_H}
          fill="url(#pcb-chip-gradient)" rx={4} opacity={0.2} />

        {/* === Via pads (corners) === */}
        {vias.map((v, i) => (
          <g key={`v-${i}`}>
            <circle cx={v.x} cy={v.y} r={2.5} fill="none"
              stroke={pcb.via.ring} strokeWidth={0.8} opacity={0.4} />
            <circle cx={v.x} cy={v.y} r={1} fill={pcb.via.fill} opacity={0.4} />
          </g>
        ))}

        {/* === Top connection pads === */}
        <g>
          {[-15, 0, 15].map((off) => (
            <g key={`tp-${off}`}>
              <rect x={BROKER_W / 2 + off - 2} y={-4} width={4} height={4}
                fill={padColor} rx={0.5} opacity={0.7} />
            </g>
          ))}
        </g>

        {/* === ASH-BROKER silkscreen === */}
        <text x={BROKER_W / 2} y={10} textAnchor="middle" dominantBaseline="central"
          fill={silkDim} fontSize={4.5} fontFamily="'IBM Plex Mono', monospace"
          letterSpacing={1.5} opacity={0.5}>
          ASH-BROKER
        </text>

        {/* === Inner simplified card === */}
        <rect x={PAD} y={PAD} width={INNER_W} height={INNER_H}
          fill={innerBg} stroke={innerBorder} strokeWidth={0.5} rx={2} />
        <rect x={PAD} y={PAD} width={INNER_W} height={INNER_H}
          fill="url(#pcb-chip-gradient)" rx={2} opacity={0.3} />

        {/* App icon */}
        {BRAND_ICONS[type] ? (
          <image
            href={BRAND_ICONS[type]}
            x={PAD + INNER_W / 2 - 14}
            y={PAD + 14}
            width={28}
            height={28}
          />
        ) : (
          <foreignObject x={PAD + INNER_W / 2 - 14} y={PAD + 14} width={28} height={28}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
              <Icon size={22} color={isDark ? pcb.trace.bright : '#555'} />
            </div>
          </foreignObject>
        )}

        {/* App name */}
        <text x={PAD + INNER_W / 2} y={PAD + 54} textAnchor="middle" dominantBaseline="central"
          fill={silkColor} fontSize={7} fontFamily="'IBM Plex Mono', monospace"
          fontWeight={700} letterSpacing={0.5}>
          {name.toUpperCase().slice(0, 16)}
        </text>

        {/* Type label */}
        <text x={PAD + INNER_W / 2} y={PAD + 68} textAnchor="middle" dominantBaseline="central"
          fill={silkDim} fontSize={5} fontFamily="'IBM Plex Mono', monospace"
          letterSpacing={0.3} opacity={0.6}>
          {(type || 'unknown').toUpperCase()}
        </text>

        {/* Status LED */}
        <g>
          <circle cx={PAD + INNER_W / 2} cy={PAD + INNER_H - 20} r={6}
            fill={ledColor} opacity={0.15}
            style={{ animation: 'pcb-led-glow-breathe 2s ease-in-out infinite' }} />
          <rect x={PAD + INNER_W / 2 - 4} y={PAD + INNER_H - 22} width={8} height={3}
            fill={isDark ? pcb.component.bodyLight : '#e0e0d8'}
            stroke="rgba(80,80,80,0.2)" strokeWidth={0.3} rx={0.5} />
          <rect x={PAD + INNER_W / 2 - 3} y={PAD + INNER_H - 21.5} width={6} height={2}
            fill={ledColor} rx={0.5} opacity={0.85}
            style={{ animation: 'pcb-led-pulse 2s ease-in-out infinite' }} />
        </g>

        {/* Status text */}
        <text x={PAD + INNER_W / 2} y={PAD + INNER_H - 8} textAnchor="middle" dominantBaseline="central"
          fill={status === 'shielded' ? '#2D6B3F' : status === 'shielding' ? '#EEA45F' : '#E1583E'}
          fontSize={4} fontFamily="'IBM Plex Mono', monospace"
          letterSpacing={0.5} opacity={0.6}>
          {status.toUpperCase()}
        </text>

        {/* === Exposed overlay (when unshielded) === */}
        {status === 'unshielded' && (
          <rect x={PAD - 1} y={PAD - 1} width={INNER_W + 2} height={INNER_H + 2}
            fill="none" stroke="#E1583E" strokeWidth={1} rx={3}
            style={{ animation: 'danger-card-pulse 2s ease-in-out infinite' }} />
        )}

        {/* === Bottom silkscreen === */}
        <text x={BROKER_W / 2} y={BROKER_H - 5} textAnchor="middle" dominantBaseline="central"
          fill={silkDim} fontSize={3.5} fontFamily="'IBM Plex Mono', monospace"
          letterSpacing={0.8} opacity={0.4}>
          REV:A
        </text>
      </svg>
    </div>
  );
});
BrokerNode.displayName = 'BrokerNode';
