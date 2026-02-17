/**
 * SystemBusNode — horizontal bus bar connecting Computer to expansion cards.
 *
 * Similar to ShieldCoreNode but without AgenShield branding.
 * Shows the raw system bus with no firewall or policy enforcement.
 */

import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { CircuitBoard } from 'lucide-react';
import { useTheme } from '@mui/material/styles';
import { pcb } from '../../styles/pcb-tokens';
import type { SystemBusData } from '../../Canvas.types';

const PIN_LEAD_WIDTH = 1.5;
const PIN_LEAD_LENGTH = 5;
const PIN_PAD_WIDTH = 5;
const PIN_PAD_LENGTH = 4;
const PIN_TOTAL = PIN_LEAD_LENGTH + PIN_PAD_LENGTH;

export const SystemBusNode = memo(({ data }: NodeProps) => {
  const {
    width: nodeWidth,
    status,
    topHandlePositions,
    bottomHandlePositions,
  } = data as unknown as SystemBusData;

  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';

  const w = nodeWidth ?? 500;
  const h = 70;
  const bodyColor = isDark ? pcb.component.body : pcb.light.body;
  const silkColor = isDark ? pcb.silk.primary : pcb.light.silk;
  const silkDim = isDark ? pcb.silk.dim : '#6A6A5A';
  const borderColor = 'rgba(136, 136, 136, 0.4)';
  const pinColor = pcb.component.pin;
  const padColor = pcb.component.padGold;
  const ledColor = status === 'protected' ? pcb.component.ledGreen : pcb.component.ledRed;

  const topHandleCount = topHandlePositions?.length ?? 1;
  const topPads = Array.from({ length: topHandleCount }, (_, i) =>
    topHandlePositions?.[i] ?? ((i + 1) / (topHandleCount + 1)) * w,
  );

  const bottomHandleCount = bottomHandlePositions?.length ?? 1;
  const bottomPads = Array.from({ length: bottomHandleCount }, (_, i) =>
    bottomHandlePositions?.[i] ?? ((i + 1) / (bottomHandleCount + 1)) * w,
  );

  function renderBusPins(pads: number[], side: 'top' | 'bottom') {
    return pads.map((px, i) => {
      if (side === 'top') {
        const leadBottom = 0;
        const leadTop = leadBottom - PIN_LEAD_LENGTH;
        const padTop = leadTop - PIN_PAD_LENGTH;
        return (
          <g key={`pin-top-${i}`}>
            <rect x={px - PIN_PAD_WIDTH / 2} y={padTop} width={PIN_PAD_WIDTH} height={PIN_PAD_LENGTH} fill={padColor} rx={0.5} />
            <line x1={px} y1={leadTop} x2={px} y2={leadBottom} stroke={pinColor} strokeWidth={PIN_LEAD_WIDTH} />
          </g>
        );
      } else {
        const leadTop = h;
        const leadBottom = leadTop + PIN_LEAD_LENGTH;
        return (
          <g key={`pin-bottom-${i}`}>
            <line x1={px} y1={leadTop} x2={px} y2={leadBottom} stroke={pinColor} strokeWidth={PIN_LEAD_WIDTH} />
            <rect x={px - PIN_PAD_WIDTH / 2} y={leadBottom} width={PIN_PAD_WIDTH} height={PIN_PAD_LENGTH} fill={padColor} rx={0.5} />
          </g>
        );
      }
    });
  }

  const svgW = w;
  const svgH = h + PIN_TOTAL * 2;
  const bodyY = PIN_TOTAL;

  return (
    <div style={{ position: 'relative', cursor: 'default' }}>
      {/* Top handles — target (receiving from computer) */}
      {Array.from({ length: topHandleCount }, (_, i) => (
        <Handle
          key={`top-${i}`}
          type="target"
          position={Position.Top}
          id={`top-${i}`}
          style={{
            left: topHandlePositions?.[i] != null ? topHandlePositions[i] : `${((i + 1) / (topHandleCount + 1)) * 100}%`,
            visibility: 'hidden',
          }}
        />
      ))}

      <svg width={svgW} height={svgH} viewBox={`0 0 ${svgW} ${svgH}`} style={{ display: 'block', overflow: 'visible' }}>
        {/* Gull-wing pins top & bottom */}
        <g transform={`translate(0, ${bodyY})`}>
          {renderBusPins(topPads, 'top')}
          {renderBusPins(bottomPads, 'bottom')}
        </g>

        {/* Body */}
        <rect x={0} y={bodyY} width={w} height={h} fill={bodyColor} stroke={borderColor} strokeWidth={1.5} rx={2} />
        <rect x={0} y={bodyY} width={w} height={h} fill="url(#pcb-chip-gradient)" rx={2} opacity={0.3} />

        {/* Horizontal bus trace lines */}
        <g opacity={0.15}>
          {[0.2, 0.35, 0.5, 0.65, 0.8].map((ratio, i) => (
            <line
              key={`trace-${i}`}
              x1={8}
              y1={bodyY + h * ratio}
              x2={w - 8}
              y2={bodyY + h * ratio}
              stroke={pcb.trace.silver}
              strokeWidth={1}
            />
          ))}
        </g>

        {/* Top via pads at handle positions */}
        {topPads.map((px, i) => (
          <g key={`top-via-${i}`}>
            <circle cx={px} cy={bodyY} r={5} fill="none" stroke={pcb.via.ring} strokeWidth={1.5} opacity={0.4} />
            <circle cx={px} cy={bodyY} r={2} fill={pcb.via.fill} opacity={0.3} />
          </g>
        ))}

        {/* Bottom via pads */}
        {bottomPads.map((px, i) => (
          <g key={`bottom-via-${i}`}>
            <circle cx={px} cy={bodyY + h} r={5} fill="none" stroke={pcb.via.ring} strokeWidth={1.5} opacity={0.4} />
            <circle cx={px} cy={bodyY + h} r={2} fill={pcb.via.fill} opacity={0.3} />
          </g>
        ))}

        {/* Pin-1 dot */}
        <circle cx={8} cy={bodyY + 8} r={2.5} fill={silkDim} opacity={0.5} />

        {/* CircuitBoard icon */}
        <foreignObject x={14} y={bodyY + h / 2 - 12} width={24} height={24}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
            <CircuitBoard size={20} color={pcb.trace.bright} />
          </div>
        </foreignObject>

        {/* Silkscreen: SYSTEM BUS */}
        <text
          x={w / 2}
          y={bodyY + h / 2 - 8}
          textAnchor="middle"
          dominantBaseline="central"
          fill={silkColor}
          fontSize={12}
          fontFamily="'IBM Plex Mono', monospace"
          fontWeight={700}
          letterSpacing={2}
        >
          SYSTEM BUS
        </text>

        {/* Sublabel */}
        <text
          x={w / 2}
          y={bodyY + h / 2 + 10}
          textAnchor="middle"
          dominantBaseline="central"
          fill={silkDim}
          fontSize={8}
          fontFamily="'IBM Plex Mono', monospace"
          letterSpacing={0.5}
        >
          {status === 'protected' ? 'Protected by AgenShield' : 'No firewall \u00B7 No policy enforcement'}
        </text>

        {/* Status LED */}
        <circle cx={w - 18} cy={bodyY + h / 2} r={5} fill={ledColor} opacity={0.25} />
        <circle cx={w - 18} cy={bodyY + h / 2} r={3.5} fill={ledColor} filter="url(#pcb-glow-signal)" />
      </svg>

      {/* Bottom handles — source (sending to cards below) */}
      {Array.from({ length: bottomHandleCount }, (_, i) => (
        <Handle
          key={`bottom-${i}`}
          type="source"
          position={Position.Bottom}
          id={`bottom-${i}`}
          style={{
            left: bottomHandlePositions?.[i] != null ? bottomHandlePositions[i] : `${((i + 1) / (bottomHandleCount + 1)) * 100}%`,
            visibility: 'hidden',
          }}
        />
      ))}
    </div>
  );
});
SystemBusNode.displayName = 'SystemBusNode';
