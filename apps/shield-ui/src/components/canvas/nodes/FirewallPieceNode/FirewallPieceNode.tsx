import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Globe, Shield, FolderLock } from 'lucide-react';
import { useTheme } from '@mui/material/styles';
import { pcb } from '../../styles/pcb-tokens';
import type { FirewallPieceData } from '../../Canvas.types';

const iconMap: Record<string, React.ComponentType<{ size?: number; color?: string }>> = {
  network: Globe,
  system: Shield,
  filesystem: FolderLock,
};

const labelMap: Record<string, string> = {
  network: 'NET CTRL',
  system: 'SYS PROC',
  filesystem: 'FS CTRL',
};

interface ChipConfig {
  w: number;
  h: number;
  pinsTop: number;
  pinsBottom: number;
  pinsLeft: number;
  pinsRight: number;
}

const chipConfigs: Record<string, ChipConfig> = {
  network: { w: 100, h: 100, pinsTop: 6, pinsBottom: 6, pinsLeft: 6, pinsRight: 6 },
  system: { w: 120, h: 120, pinsTop: 8, pinsBottom: 8, pinsLeft: 8, pinsRight: 8 },
  filesystem: { w: 200, h: 60, pinsTop: 0, pinsBottom: 12, pinsLeft: 2, pinsRight: 2 },
};

const PIN_LEAD_WIDTH = 1.5;
const PIN_LEAD_LENGTH = 5;
const PIN_PAD_WIDTH = 5;
const PIN_PAD_LENGTH = 4;
const PIN_TOTAL = PIN_LEAD_LENGTH + PIN_PAD_LENGTH;
const PIN_INSET = 8;

export const FirewallPieceNode = memo(({ data }: NodeProps) => {
  const { id, active } = data as unknown as FirewallPieceData;
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';
  const IconComp = iconMap[id] ?? Shield;
  const silkLabel = labelMap[id] ?? 'CTRL';
  const cfg = chipConfigs[id] ?? chipConfigs.network;

  const bodyColor = isDark ? pcb.component.body : pcb.light.body;
  const silkColor = isDark ? pcb.silk.primary : pcb.light.silk;
  const silkDim = isDark ? pcb.silk.dim : '#6A6A5A';
  const pinColor = pcb.component.pin;
  const padColor = active ? pcb.component.padGold : pcb.trace.dimmed;
  const borderColor = active ? 'rgba(136, 136, 136, 0.4)' : 'rgba(136, 136, 136, 0.15)';
  const ledColor = active ? pcb.component.ledGreen : pcb.component.ledOff;

  const svgW = cfg.w + (cfg.pinsLeft > 0 ? PIN_TOTAL : 0) + (cfg.pinsRight > 0 ? PIN_TOTAL : 0);
  const svgH = cfg.h + (cfg.pinsTop > 0 ? PIN_TOTAL : 0) + (cfg.pinsBottom > 0 ? PIN_TOTAL : 0);
  const bodyX = cfg.pinsLeft > 0 ? PIN_TOTAL : 0;
  const bodyY = cfg.pinsTop > 0 ? PIN_TOTAL : 0;

  function renderGullWingPins(count: number, side: 'top' | 'bottom' | 'left' | 'right') {
    if (count === 0) return null;
    const pins: React.ReactNode[] = [];
    for (let i = 0; i < count; i++) {
      if (side === 'top' || side === 'bottom') {
        const span = cfg.w - PIN_INSET * 2;
        const spacing = count > 1 ? span / (count - 1) : 0;
        const px = bodyX + PIN_INSET + (count > 1 ? i * spacing : span / 2);

        if (side === 'top') {
          const leadBottom = bodyY;
          const leadTop = leadBottom - PIN_LEAD_LENGTH;
          const padTop = leadTop - PIN_PAD_LENGTH;
          pins.push(
            <g key={`top-${i}`}>
              <rect x={px - PIN_PAD_WIDTH / 2} y={padTop} width={PIN_PAD_WIDTH} height={PIN_PAD_LENGTH} fill={padColor} rx={0.5} />
              <line x1={px} y1={leadTop} x2={px} y2={leadBottom} stroke={pinColor} strokeWidth={PIN_LEAD_WIDTH} />
            </g>,
          );
        } else {
          const leadTop = bodyY + cfg.h;
          const leadBottom = leadTop + PIN_LEAD_LENGTH;
          pins.push(
            <g key={`bottom-${i}`}>
              <line x1={px} y1={leadTop} x2={px} y2={leadBottom} stroke={pinColor} strokeWidth={PIN_LEAD_WIDTH} />
              <rect x={px - PIN_PAD_WIDTH / 2} y={leadBottom} width={PIN_PAD_WIDTH} height={PIN_PAD_LENGTH} fill={padColor} rx={0.5} />
            </g>,
          );
        }
      } else {
        const span = cfg.h - PIN_INSET * 2;
        const spacing = count > 1 ? span / (count - 1) : 0;
        const py = bodyY + PIN_INSET + (count > 1 ? i * spacing : span / 2);

        if (side === 'left') {
          const leadRight = bodyX;
          const leadLeft = leadRight - PIN_LEAD_LENGTH;
          const padLeft = leadLeft - PIN_PAD_LENGTH;
          pins.push(
            <g key={`left-${i}`}>
              <rect x={padLeft} y={py - PIN_PAD_WIDTH / 2} width={PIN_PAD_LENGTH} height={PIN_PAD_WIDTH} fill={padColor} rx={0.5} />
              <line x1={leadLeft} y1={py} x2={leadRight} y2={py} stroke={pinColor} strokeWidth={PIN_LEAD_WIDTH} />
            </g>,
          );
        } else {
          const leadLeft = bodyX + cfg.w;
          const leadRight = leadLeft + PIN_LEAD_LENGTH;
          pins.push(
            <g key={`right-${i}`}>
              <line x1={leadLeft} y1={py} x2={leadRight} y2={py} stroke={pinColor} strokeWidth={PIN_LEAD_WIDTH} />
              <rect x={leadRight} y={py - PIN_PAD_WIDTH / 2} width={PIN_PAD_LENGTH} height={PIN_PAD_WIDTH} fill={padColor} rx={0.5} />
            </g>,
          );
        }
      }
    }
    return pins;
  }

  return (
    <div style={{ position: 'relative', cursor: 'default', opacity: active ? 1 : 0.5 }}>
      <Handle type="target" position={Position.Top} id="top" style={{ visibility: 'hidden' }} />
      <svg width={svgW} height={svgH} viewBox={`0 0 ${svgW} ${svgH}`} style={{ display: 'block', overflow: 'visible' }}>
        {renderGullWingPins(cfg.pinsTop, 'top')}
        {renderGullWingPins(cfg.pinsBottom, 'bottom')}
        {renderGullWingPins(cfg.pinsLeft, 'left')}
        {renderGullWingPins(cfg.pinsRight, 'right')}

        {/* Body */}
        <rect x={bodyX} y={bodyY} width={cfg.w} height={cfg.h} fill={bodyColor} stroke={borderColor} strokeWidth={1} rx={2} />
        <rect x={bodyX} y={bodyY} width={cfg.w} height={cfg.h} fill="url(#pcb-chip-gradient)" rx={2} opacity={0.3} />

        {/* Pin-1 dot */}
        <circle cx={bodyX + 8} cy={bodyY + 8} r={2} fill={silkDim} opacity={0.5} />

        {/* Heat-sink lines for system chip */}
        {id === 'system' && (
          <g opacity={0.12}>
            {[0.25, 0.4, 0.55, 0.7].map((r, i) => (
              <line key={i} x1={bodyX + 8} y1={bodyY + cfg.h * r} x2={bodyX + cfg.w - 8} y2={bodyY + cfg.h * r} stroke={pcb.trace.silver} strokeWidth={0.8} />
            ))}
          </g>
        )}

        {/* Filesystem notch */}
        {id === 'filesystem' && (
          <rect x={bodyX} y={bodyY + 10} width={8} height={cfg.h - 20} fill={isDark ? '#0D0D1E' : '#D8D8D0'} rx={1} />
        )}

        {/* Icon */}
        <foreignObject x={bodyX + cfg.w / 2 - 12} y={bodyY + (id === 'filesystem' ? 8 : cfg.h / 2 - 22)} width={24} height={24}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
            <IconComp size={18} color={active ? pcb.trace.bright : pcb.trace.dimmed} />
          </div>
        </foreignObject>

        {/* Silkscreen label */}
        <text
          x={bodyX + cfg.w / 2}
          y={bodyY + (id === 'filesystem' ? cfg.h / 2 + 4 : cfg.h / 2 + 8)}
          textAnchor="middle"
          dominantBaseline="central"
          fill={silkColor}
          fontSize={10}
          fontFamily="'IBM Plex Mono', monospace"
          fontWeight={600}
          letterSpacing={1}
        >
          {silkLabel}
        </text>

        {/* LED */}
        {ledColor !== pcb.component.ledOff && (
          <circle cx={bodyX + cfg.w - 10} cy={bodyY + 10} r={3} fill={ledColor} opacity={0.3} />
        )}
        <circle cx={bodyX + cfg.w - 10} cy={bodyY + 10} r={2.5} fill={ledColor} filter={ledColor !== pcb.component.ledOff ? 'url(#pcb-glow-signal)' : undefined} />
      </svg>
      <Handle type="source" position={Position.Bottom} id="bottom" style={{ visibility: 'hidden' }} />
      <Handle type="target" position={Position.Left} id="left" style={{ visibility: 'hidden' }} />
      <Handle type="source" position={Position.Right} id="right" style={{ visibility: 'hidden' }} />
    </div>
  );
});
FirewallPieceNode.displayName = 'FirewallPieceNode';
