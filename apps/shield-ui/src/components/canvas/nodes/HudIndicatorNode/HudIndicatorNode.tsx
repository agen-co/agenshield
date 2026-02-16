import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Wifi, Lock, Bell, Activity, Cloud } from 'lucide-react';
import { useTheme } from '@mui/material/styles';
import { pcb } from '../../styles/pcb-tokens';
import type { HudIndicatorData } from '../../Canvas.types';

const iconMap: Record<string, React.ComponentType<{ size?: number; color?: string }>> = {
  connectivity: Wifi,
  auth: Lock,
  alerts: Bell,
  throughput: Activity,
  cloud: Cloud,
};

const statusColorMap: Record<string, string> = {
  ok: '#6CB685',
  warning: '#EEA45F',
  error: '#E1583E',
};

// Display module dimensions
const BODY_W = 56;
const BODY_H = 48;
const SCREEN_INSET_X = 5;
const SCREEN_INSET_Y = 5;
const SCREEN_W = BODY_W - SCREEN_INSET_X * 2; // 46
const SCREEN_H = 24;

// Pin constants (matching PcbChip)
const PIN_LEAD_WIDTH = 1.5;
const PIN_LEAD_LENGTH = 5;
const PIN_PAD_WIDTH = 5;
const PIN_PAD_LENGTH = 4;
const PIN_TOTAL = PIN_LEAD_LENGTH + PIN_PAD_LENGTH;
const PIN_SPACING = 16;

export const HudIndicatorNode = memo(({ data }: NodeProps) => {
  const { type, label, status } = data as unknown as HudIndicatorData;
  const IconComp = iconMap[type] ?? Activity;
  const color = statusColorMap[status] ?? '#808080';
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';

  const bodyColor = isDark ? pcb.component.body : pcb.light.body;
  const borderColor = isDark ? 'rgba(136, 136, 136, 0.3)' : 'rgba(136, 136, 136, 0.5)';
  const silkDim = isDark ? pcb.silk.dim : '#6A6A5A';
  const pinColor = pcb.component.pin;
  const padColor = pcb.component.padGold;

  const ledColor = status === 'ok' ? pcb.component.ledGreen
    : status === 'warning' ? pcb.component.ledAmber
    : pcb.component.ledRed;

  // Screen fill: slightly lighter than body
  const screenFill = isDark ? '#0A0A0A' : '#D8D8D0';
  // Screen border glow color (subtle, based on status)
  const screenGlow = color;

  const svgW = BODY_W;
  const svgH = BODY_H + PIN_TOTAL; // bottom pins extend below body

  // Two bottom pin positions (symmetric)
  const pinCx1 = BODY_W / 2 - PIN_SPACING / 2;
  const pinCx2 = BODY_W / 2 + PIN_SPACING / 2;

  // Part number abbreviation
  const partMap: Record<string, string> = {
    connectivity: 'SSE',
    auth: 'AUTH',
    alerts: 'ALR',
    throughput: 'EVT',
    cloud: 'CLD',
  };
  const partNo = partMap[type] ?? 'OLED';

  return (
    <div style={{ position: 'relative', cursor: 'default' }}>
      <Handle type="target" position={Position.Bottom} id="bottom-rx" style={{ left: pinCx1, visibility: 'hidden' }} />
      <Handle type="target" position={Position.Bottom} id="bottom-tx" style={{ left: pinCx2, visibility: 'hidden' }} />

      <svg
        width={svgW}
        height={svgH}
        viewBox={`0 0 ${svgW} ${svgH}`}
        style={{ display: 'block', overflow: 'visible' }}
      >
        {/* Bottom gull-wing pins */}
        {[pinCx1, pinCx2].map((px, i) => {
          const leadTop = BODY_H;
          const leadBottom = leadTop + PIN_LEAD_LENGTH;
          return (
            <g key={`pin-${i}`}>
              <line
                x1={px} y1={leadTop} x2={px} y2={leadBottom}
                stroke={pinColor} strokeWidth={PIN_LEAD_WIDTH}
              />
              <rect
                x={px - PIN_PAD_WIDTH / 2} y={leadBottom}
                width={PIN_PAD_WIDTH} height={PIN_PAD_LENGTH}
                fill={padColor} rx={0.5}
              />
            </g>
          );
        })}

        {/* Chip body */}
        <rect
          x={0} y={0} width={BODY_W} height={BODY_H}
          fill={bodyColor} stroke={borderColor} strokeWidth={1} rx={3}
        />
        <rect
          x={0} y={0} width={BODY_W} height={BODY_H}
          fill="url(#pcb-chip-gradient)" rx={3} opacity={0.3}
        />

        {/* Pin-1 dot */}
        <circle cx={6} cy={6} r={1.5} fill={silkDim} opacity={0.5} />

        {/* Screen inset — recessed display area */}
        <rect
          x={SCREEN_INSET_X} y={SCREEN_INSET_Y}
          width={SCREEN_W} height={SCREEN_H}
          fill={screenFill}
          stroke={screenGlow}
          strokeWidth={1}
          strokeOpacity={0.5}
          rx={2}
        />
        {/* Screen glow effect (subtle outer glow) */}
        <rect
          x={SCREEN_INSET_X - 1} y={SCREEN_INSET_Y - 1}
          width={SCREEN_W + 2} height={SCREEN_H + 2}
          fill="none"
          stroke={screenGlow}
          strokeWidth={0.5}
          strokeOpacity={0.2}
          rx={3}
        />

        {/* Screen content: icon + status dot + label */}
        <foreignObject
          x={SCREEN_INSET_X + 2} y={SCREEN_INSET_Y + 2}
          width={SCREEN_W - 4} height={SCREEN_H - 4}
        >
          <div style={{
            width: '100%',
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 3,
          }}>
            <IconComp size={12} color={color} />
            <div style={{
              width: 5,
              height: 5,
              borderRadius: '50%',
              backgroundColor: color,
              boxShadow: `0 0 3px ${color}`,
              flexShrink: 0,
            }} />
            <span style={{
              color: isDark ? '#CCCCCC' : '#333333',
              fontSize: 8,
              fontFamily: "'IBM Plex Mono', monospace",
              fontWeight: 600,
              letterSpacing: 0.5,
              whiteSpace: 'nowrap',
            }}>
              {label}
            </span>
          </div>
        </foreignObject>

        {/* Status LED — bottom-right of body, below screen */}
        <circle
          cx={BODY_W - 10} cy={BODY_H - 8}
          r={3} fill={ledColor} opacity={0.25}
        />
        <circle
          cx={BODY_W - 10} cy={BODY_H - 8}
          r={2} fill={ledColor} filter="url(#pcb-glow-signal)"
        />

        {/* Part number silkscreen — bottom-left */}
        <text
          x={8} y={BODY_H - 7}
          fill={silkDim}
          fontSize={6}
          fontFamily="'IBM Plex Mono', monospace"
          letterSpacing={0.5}
          opacity={0.6}
        >
          {partNo}
        </text>

        {/* RX / TX silkscreen labels beside bottom pins */}
        <text
          x={pinCx1} y={BODY_H + PIN_TOTAL + 7}
          textAnchor="middle"
          fill={silkDim}
          fontSize={5}
          fontFamily="'IBM Plex Mono', monospace"
          letterSpacing={0.3}
          opacity={0.7}
        >
          RX
        </text>
        <text
          x={pinCx2} y={BODY_H + PIN_TOTAL + 7}
          textAnchor="middle"
          fill={silkDim}
          fontSize={5}
          fontFamily="'IBM Plex Mono', monospace"
          letterSpacing={0.3}
          opacity={0.7}
        >
          TX
        </text>
      </svg>
    </div>
  );
});
HudIndicatorNode.displayName = 'HudIndicatorNode';
