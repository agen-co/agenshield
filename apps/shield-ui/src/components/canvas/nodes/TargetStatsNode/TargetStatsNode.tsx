import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Zap, Shield, KeyRound } from 'lucide-react';
import { useTheme } from '@mui/material/styles';
import { pcb } from '../../styles/pcb-tokens';
import type { TargetStatsNodeData } from '../../Canvas.types';

const CHIP_W = 40;
const CHIP_H = 24;
const MINI_PAD_W = 4;
const MINI_PAD_L = 3;
const MINI_LEAD_W = 1;
const MINI_LEAD_L = 3;
const MINI_TOTAL = MINI_PAD_L + MINI_LEAD_L;
const GAP = 8;

interface MiniChipProps {
  icon: React.ReactNode;
  value: number;
  offsetX: number;
}

function MiniChip({ icon, value, offsetX }: MiniChipProps) {
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';
  const bodyColor = isDark ? pcb.component.body : pcb.light.body;
  const silkColor = isDark ? pcb.silk.primary : pcb.light.silk;
  const pinColor = pcb.component.pin;
  const padColor = pcb.component.padGold;

  return (
    <g transform={`translate(${offsetX}, 0)`}>
      {/* Left gull-wing pins */}
      {[0, 1].map((i) => {
        const py = 4 + i * 10;
        return (
          <g key={`l-${i}`}>
            <rect x={0} y={py - MINI_PAD_W / 2} width={MINI_PAD_L} height={MINI_PAD_W} fill={padColor} rx={0.5} />
            <line x1={MINI_PAD_L} y1={py} x2={MINI_PAD_L + MINI_LEAD_L} y2={py} stroke={pinColor} strokeWidth={MINI_LEAD_W} />
          </g>
        );
      })}
      {/* Right gull-wing pins */}
      {[0, 1].map((i) => {
        const py = 4 + i * 10;
        return (
          <g key={`r-${i}`}>
            <line x1={MINI_TOTAL + CHIP_W} y1={py} x2={MINI_TOTAL + CHIP_W + MINI_LEAD_L} y2={py} stroke={pinColor} strokeWidth={MINI_LEAD_W} />
            <rect x={MINI_TOTAL + CHIP_W + MINI_LEAD_L} y={py - MINI_PAD_W / 2} width={MINI_PAD_L} height={MINI_PAD_W} fill={padColor} rx={0.5} />
          </g>
        );
      })}
      {/* Body */}
      <rect x={MINI_TOTAL} y={0} width={CHIP_W} height={CHIP_H} fill={bodyColor} stroke="rgba(136,136,136,0.2)" strokeWidth={0.5} rx={1} />
      {/* Pin-1 dot */}
      <circle cx={MINI_TOTAL + 4} cy={4} r={1.5} fill={silkColor} opacity={0.3} />
      {/* Icon slot */}
      <foreignObject x={MINI_TOTAL + 2} y={2} width={16} height={20}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
          {icon}
        </div>
      </foreignObject>
      {/* Value text */}
      <text
        x={MINI_TOTAL + CHIP_W - 6}
        y={CHIP_H / 2}
        textAnchor="end"
        dominantBaseline="central"
        fill={silkColor}
        fontSize={9}
        fontFamily="'IBM Plex Mono', monospace"
        fontWeight={600}
      >
        {value}
      </text>
    </g>
  );
}

export const TargetStatsNode = memo(({ data }: NodeProps) => {
  const { skillCount, policyCount, secretCount } = data as unknown as TargetStatsNodeData;
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';
  const iconColor = isDark ? pcb.silk.dim : '#6A6A5A';

  const chipPitch = MINI_TOTAL + CHIP_W + MINI_TOTAL + GAP;
  const totalWidth = chipPitch * 3 - GAP;

  return (
    <div style={{ cursor: 'default' }}>
      <Handle type="target" position={Position.Top} id="top" style={{ visibility: 'hidden' }} />
      <svg width={totalWidth} height={CHIP_H} viewBox={`0 0 ${totalWidth} ${CHIP_H}`} style={{ display: 'block', overflow: 'visible' }}>
        <MiniChip icon={<Zap size={10} color={iconColor} />} value={skillCount} offsetX={0} />
        <MiniChip icon={<Shield size={10} color={iconColor} />} value={policyCount} offsetX={chipPitch} />
        <MiniChip icon={<KeyRound size={10} color={iconColor} />} value={secretCount} offsetX={chipPitch * 2} />
      </svg>
      <Handle type="source" position={Position.Bottom} id="bottom" style={{ visibility: 'hidden' }} />
    </div>
  );
});
TargetStatsNode.displayName = 'TargetStatsNode';
