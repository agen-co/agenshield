import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { useTheme } from '@mui/material/styles';
import { Wifi, Lock, Bell, Activity, Cloud } from 'lucide-react';
import { pcb } from '../../styles/pcb-tokens';
import type { HudPanelNodeData } from '../../Canvas.types';

const statusColorMap: Record<string, string> = {
  ok: '#6CB685',
  warning: '#EEA45F',
  error: '#E1583E',
};

function getStatusColor(status: string): string {
  return statusColorMap[status] ?? '#808080';
}

const hudIconMap: Record<string, React.ComponentType<{ size?: number; color?: string }>> = {
  connectivity: Wifi,
  auth: Lock,
  alerts: Bell,
  throughput: Activity,
  cloud: Cloud,
};

const PIN_LEAD_WIDTH = 1.5;
const PIN_LEAD_LENGTH = 5;
const PIN_PAD_WIDTH = 5;
const PIN_PAD_LENGTH = 4;
const PIN_TOTAL = PIN_LEAD_LENGTH + PIN_PAD_LENGTH;
const PIN_INSET = 6;
const CHIP_W = 300;
const CHIP_H = 50;

export const HudPanelNode = memo(({ data }: NodeProps) => {
  const { indicators } = data as unknown as HudPanelNodeData;
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';

  const bodyColor = isDark ? pcb.component.body : pcb.light.body;
  const silkColor = isDark ? pcb.silk.primary : pcb.light.silk;
  const silkDim = isDark ? pcb.silk.dim : '#6A6A5A';
  const pinColor = pcb.component.pin;
  const padColor = pcb.component.padGold;
  const borderColor = 'rgba(136, 136, 136, 0.3)';

  // Left-side gull-wing pins (4 pins)
  const leftPinCount = 4;
  const svgW = CHIP_W + PIN_TOTAL; // pins on left only
  const svgH = CHIP_H;
  const bodyX = PIN_TOTAL;

  function renderLeftPins() {
    const pins: React.ReactNode[] = [];
    const span = CHIP_H - PIN_INSET * 2;
    const spacing = span / (leftPinCount - 1);
    for (let i = 0; i < leftPinCount; i++) {
      const py = PIN_INSET + i * spacing;
      const leadRight = bodyX;
      const leadLeft = leadRight - PIN_LEAD_LENGTH;
      const padLeft = leadLeft - PIN_PAD_LENGTH;
      pins.push(
        <g key={`left-${i}`}>
          <rect x={padLeft} y={py - PIN_PAD_WIDTH / 2} width={PIN_PAD_LENGTH} height={PIN_PAD_WIDTH} fill={padColor} rx={0.5} />
          <line x1={leadLeft} y1={py} x2={leadRight} y2={py} stroke={pinColor} strokeWidth={PIN_LEAD_WIDTH} />
        </g>,
      );
    }
    return pins;
  }

  return (
    <div style={{ position: 'relative', cursor: 'default' }}>
      <Handle type="target" position={Position.Left} id="left" style={{ visibility: 'hidden' }} />
      <svg width={svgW} height={svgH} viewBox={`0 0 ${svgW} ${svgH}`} style={{ display: 'block', overflow: 'visible' }}>
        {renderLeftPins()}

        {/* Body */}
        <rect x={bodyX} y={0} width={CHIP_W} height={CHIP_H} fill={bodyColor} stroke={borderColor} strokeWidth={1} rx={2} />
        <rect x={bodyX} y={0} width={CHIP_W} height={CHIP_H} fill="url(#pcb-chip-gradient)" rx={2} opacity={0.3} />

        {/* Pin-1 dot */}
        <circle cx={bodyX + 6} cy={6} r={2} fill={silkDim} opacity={0.5} />

        {/* "STATUS" silkscreen label — top center */}
        <text
          x={bodyX + CHIP_W / 2}
          y={10}
          textAnchor="middle"
          dominantBaseline="central"
          fill={silkColor}
          fontSize={7}
          fontFamily="'IBM Plex Mono', monospace"
          fontWeight={600}
          letterSpacing={1.5}
          opacity={0.6}
        >
          STATUS MONITOR
        </text>

        {/* Indicator row via foreignObject */}
        <foreignObject x={bodyX + 4} y={16} width={CHIP_W - 8} height={CHIP_H - 18}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            height: '100%',
            padding: '0 4px',
          }}>
            {indicators.map((ind) => {
              const IconComp = hudIconMap[ind.type] ?? Activity;
              const color = getStatusColor(ind.status);
              return (
                <div key={ind.type} style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 3,
                  whiteSpace: 'nowrap',
                }}>
                  <IconComp size={11} color={color} />
                  <div style={{
                    width: 5,
                    height: 5,
                    borderRadius: '50%',
                    backgroundColor: color,
                    boxShadow: `0 0 4px ${color}`,
                    flexShrink: 0,
                  }} />
                  <span style={{
                    fontSize: 8,
                    fontWeight: 600,
                    fontFamily: "'IBM Plex Mono', monospace",
                    color: isDark ? '#A0A090' : '#6A6A5A',
                    letterSpacing: 0.3,
                  }}>
                    {ind.label}
                    {ind.value ? ` (${ind.value})` : ''}
                  </span>
                </div>
              );
            })}
          </div>
        </foreignObject>
      </svg>
    </div>
  );
});
HudPanelNode.displayName = 'HudPanelNode';
