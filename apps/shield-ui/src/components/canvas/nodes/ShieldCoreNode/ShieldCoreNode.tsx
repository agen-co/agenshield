import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Shield } from 'lucide-react';
import { useTheme } from '@mui/material/styles';
import { pcb } from '../../styles/pcb-tokens';
import type { ShieldCoreData, CanvasStatus } from '../../Canvas.types';

const ledColorMap: Record<CanvasStatus, string> = {
  ok: pcb.component.ledGreen,
  warning: pcb.component.ledAmber,
  error: pcb.component.ledRed,
};

const PIN_LEAD_WIDTH = 1.5;
const PIN_LEAD_LENGTH = 5;
const PIN_PAD_WIDTH = 5;
const PIN_PAD_LENGTH = 4;
const PIN_TOTAL = PIN_LEAD_LENGTH + PIN_PAD_LENGTH;
const PIN_INSET = 8;
const HUD_RIGHT_PIN_COUNT = 10; // 2 per indicator × 5 indicators

export const ShieldCoreNode = memo(({ data }: NodeProps) => {
  const {
    status,
    version,
    uptime,
    activePolicies,
    targetCount,
    width: nodeWidth,
    topHandlePositions,
    bottomHandlePositions,
  } = data as unknown as ShieldCoreData;

  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';

  const w = nodeWidth ?? 500;
  const h = 80;
  const bodyColor = isDark ? pcb.component.body : pcb.light.body;
  const silkColor = isDark ? pcb.silk.primary : pcb.light.silk;
  const silkDim = isDark ? pcb.silk.dim : '#6A6A5A';
  const borderColor = 'rgba(136, 136, 136, 0.4)';
  const pinColor = pcb.component.pin;
  const padColor = pcb.component.padGold;
  const ledColor = ledColorMap[status];

  const topHandleCount = Math.max(targetCount ?? 1, 1);

  // Via pad positions for handles
  const topPads = Array.from({ length: topHandleCount }, (_, i) =>
    topHandlePositions?.[i] ?? ((i + 1) / (topHandleCount + 1)) * w,
  );
  const bottomHandleCount = bottomHandlePositions?.length ?? 3;
  const bottomPads = Array.from({ length: bottomHandleCount }, (_, i) =>
    bottomHandlePositions?.[i] ?? ((i + 1) / (bottomHandleCount + 1)) * w,
  );

  // Render gull-wing pins at handle positions
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

  // Render right-side gull-wing pins for HUD connections (2 per indicator, horizontal)
  function renderRightHudPins() {
    return Array.from({ length: HUD_RIGHT_PIN_COUNT }, (_, j) => {
      const py = h * (j + 1) / (HUD_RIGHT_PIN_COUNT + 1);
      const leadLeft = w;
      const leadRight = leadLeft + PIN_LEAD_LENGTH;
      return (
        <g key={`pin-right-hud-${j}`}>
          <line x1={leadLeft} y1={py} x2={leadRight} y2={py} stroke={pinColor} strokeWidth={PIN_LEAD_WIDTH} />
          <rect x={leadRight} y={py - PIN_PAD_WIDTH / 2} width={PIN_PAD_LENGTH} height={PIN_PAD_WIDTH} fill={padColor} rx={0.5} />
        </g>
      );
    });
  }

  const svgW = w;
  const svgH = h + PIN_TOTAL * 2; // space for top + bottom pins
  const bodyY = PIN_TOTAL;

  return (
    <div style={{ position: 'relative', cursor: 'default' }}>
      {/* Top handles — target (receiving from firewalls above) */}
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
          {renderRightHudPins()}
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

        {/* Shield icon */}
        <foreignObject x={14} y={bodyY + h / 2 - 12} width={24} height={24}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
            <Shield size={20} color={pcb.trace.bright} />
          </div>
        </foreignObject>

        {/* Silkscreen: AGENSHIELD */}
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
          AGENSHIELD
        </text>

        {/* Sublabel: version + policy count */}
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
          {`v${version} · up ${uptime} · ${activePolicies ?? 0} ${(activePolicies ?? 0) === 1 ? 'policy' : 'policies'}`}
        </text>

        {/* Status LED — right side */}
        <circle cx={w - 18} cy={bodyY + h / 2} r={5} fill={ledColor} opacity={0.25} />
        <circle cx={w - 18} cy={bodyY + h / 2} r={3.5} fill={ledColor} filter="url(#pcb-glow-signal)" />
      </svg>

      {/* Bottom handles — source (sending to stats below) */}
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
      <Handle type="source" position={Position.Left} id="bottom-left" style={{ visibility: 'hidden' }} />
      <Handle type="target" position={Position.Right} id="right" style={{ visibility: 'hidden' }} />

      {/* Right-side handles for HUD indicator connections (2 per indicator) */}
      {Array.from({ length: 5 }, (_, i) => {
        const rxJ = i * 2;
        const txJ = i * 2 + 1;
        const rxTop = bodyY + h * (rxJ + 1) / (HUD_RIGHT_PIN_COUNT + 1);
        const txTop = bodyY + h * (txJ + 1) / (HUD_RIGHT_PIN_COUNT + 1);
        return [
          <Handle
            key={`right-hud-${i}-rx`}
            type="source"
            position={Position.Right}
            id={`right-hud-${i}-rx`}
            style={{ top: rxTop, visibility: 'hidden' }}
          />,
          <Handle
            key={`right-hud-${i}-tx`}
            type="source"
            position={Position.Right}
            id={`right-hud-${i}-tx`}
            style={{ top: txTop, visibility: 'hidden' }}
          />,
        ];
      })}
    </div>
  );
});
ShieldCoreNode.displayName = 'ShieldCoreNode';
