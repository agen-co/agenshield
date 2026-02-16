import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Monitor } from 'lucide-react';
import { useTheme } from '@mui/material/styles';
import { pcb } from '../../styles/pcb-tokens';
import type { ComputerNodeData } from '../../Canvas.types';

const ledColorMap: Record<string, string> = {
  secure: pcb.component.ledGreen,
  partial: pcb.component.ledAmber,
  unprotected: pcb.component.ledRed,
  critical: pcb.component.ledRed,
};

const PIN_LEAD_WIDTH = 1.5;
const PIN_LEAD_LENGTH = 5;
const PIN_PAD_WIDTH = 5;
const PIN_PAD_LENGTH = 4;
const PIN_TOTAL = PIN_LEAD_LENGTH + PIN_PAD_LENGTH;
const PIN_INSET = 12;

export const ComputerNode = memo(({ data }: NodeProps) => {
  const { currentUser, securityLevel } = data as unknown as ComputerNodeData;
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';

  const bodyW = 200;
  const h = 70;
  const w = bodyW + PIN_TOTAL; // extra width for right-side pins
  const bodyColor = isDark ? pcb.component.body : pcb.light.body;
  const silkColor = isDark ? pcb.silk.primary : pcb.light.silk;
  const silkDim = isDark ? pcb.silk.dim : '#6A6A5A';
  const borderColor = 'rgba(136, 136, 136, 0.4)';
  const pinColor = pcb.component.pin;
  const padColor = pcb.component.padGold;
  const ledColor = ledColorMap[securityLevel] ?? pcb.component.ledGreen;

  // Gold contact fingers along top edge
  const fingerCount = 10;
  const fingerW = (bodyW - 20) / 12;

  // Right-side gull-wing pins (2 pins)
  const rightPinCount = 2;
  const span = h - PIN_INSET * 2;
  const spacing = span / (rightPinCount - 1);

  return (
    <div style={{ position: 'relative', cursor: 'default' }}>
      <Handle type="target" position={Position.Top} id="top" style={{ visibility: 'hidden' }} />
      <Handle type="source" position={Position.Bottom} id="bottom" style={{ visibility: 'hidden' }} />
      <Handle type="source" position={Position.Left} id="left" style={{ visibility: 'hidden' }} />
      <Handle type="source" position={Position.Right} id="right" style={{ visibility: 'hidden' }} />
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ display: 'block', overflow: 'visible' }}>
        {/* Right-side gull-wing pins */}
        {Array.from({ length: rightPinCount }, (_, i) => {
          const py = PIN_INSET + i * spacing;
          const leadLeft = bodyW;
          const leadRight = leadLeft + PIN_LEAD_LENGTH;
          const padLeft = leadRight;
          return (
            <g key={`pin-right-${i}`}>
              <line x1={leadLeft} y1={py} x2={leadRight} y2={py} stroke={pinColor} strokeWidth={PIN_LEAD_WIDTH} />
              <rect x={padLeft} y={py - PIN_PAD_WIDTH / 2} width={PIN_PAD_LENGTH} height={PIN_PAD_WIDTH} fill={padColor} rx={0.5} />
            </g>
          );
        })}

        {/* Body */}
        <rect x={0} y={0} width={bodyW} height={h} fill={bodyColor} stroke={borderColor} strokeWidth={1.5} rx={2} />
        <rect x={0} y={0} width={bodyW} height={h} fill="url(#pcb-chip-gradient)" rx={2} opacity={0.3} />

        {/* Gold contact fingers along top */}
        {Array.from({ length: fingerCount }, (_, i) => (
          <rect
            key={`finger-${i}`}
            x={10 + i * (fingerW + 2)}
            y={0}
            width={fingerW}
            height={6}
            fill={pcb.component.padGold}
            rx={1}
          />
        ))}

        {/* Monitor icon */}
        <foreignObject x={14} y={h / 2 - 12} width={24} height={24}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
            <Monitor size={20} color={pcb.trace.bright} />
          </div>
        </foreignObject>

        {/* Silkscreen: SYSTEM */}
        <text
          x={bodyW / 2 + 10}
          y={h / 2 - 6}
          textAnchor="middle"
          dominantBaseline="central"
          fill={silkColor}
          fontSize={11}
          fontFamily="'IBM Plex Mono', monospace"
          fontWeight={600}
          letterSpacing={1}
        >
          SYSTEM
        </text>

        {/* User sublabel */}
        <text
          x={bodyW / 2 + 10}
          y={h / 2 + 10}
          textAnchor="middle"
          dominantBaseline="central"
          fill={silkDim}
          fontSize={8}
          fontFamily="'IBM Plex Mono', monospace"
          letterSpacing={0.5}
        >
          {currentUser}
        </text>

        {/* Security level LED */}
        <circle cx={bodyW - 14} cy={14} r={4} fill={ledColor} opacity={0.25} />
        <circle cx={bodyW - 14} cy={14} r={3} fill={ledColor} filter="url(#pcb-glow-signal)" />

        {/* Pin-1 dot */}
        <circle cx={8} cy={h - 8} r={2} fill={silkDim} opacity={0.5} />
      </svg>
    </div>
  );
});
ComputerNode.displayName = 'ComputerNode';
