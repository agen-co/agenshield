import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { useSnapshot } from 'valtio';
import { useTheme } from '@mui/material/styles';
import { dotAnimationStore } from '../../state/dotAnimations';
import { pcb } from '../../styles/pcb-tokens';

const PIN_LEAD_WIDTH = 1.5;
const PIN_LEAD_LENGTH = 5;
const PIN_PAD_WIDTH = 5;
const PIN_PAD_LENGTH = 4;
const PIN_TOTAL = PIN_LEAD_LENGTH + PIN_PAD_LENGTH;
const PIN_INSET = 6;
const CHIP_W = 100;
const CHIP_H = 50;

export const DeniedBucketNode = memo((_props: NodeProps) => {
  const { deniedCount } = useSnapshot(dotAnimationStore);
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';

  const bodyColor = isDark ? pcb.component.body : pcb.light.body;
  const silkColor = isDark ? pcb.silk.primary : pcb.light.silk;
  const silkDim = isDark ? pcb.silk.dim : '#6A6A5A';
  const pinColor = pcb.component.pin;
  const padColor = pcb.component.padGold;
  const borderColor = deniedCount > 0 ? 'rgba(255, 23, 68, 0.4)' : 'rgba(136, 136, 136, 0.2)';
  const active = deniedCount > 0;

  const svgW = CHIP_W + PIN_TOTAL * 2;
  const svgH = CHIP_H;
  const bodyX = PIN_TOTAL;

  // 3 gull-wing pins per side
  function renderSidePins(side: 'left' | 'right') {
    return [0, 1, 2].map((i) => {
      const span = CHIP_H - PIN_INSET * 2;
      const spacing = span / 2;
      const py = PIN_INSET + i * spacing;

      if (side === 'left') {
        const leadRight = bodyX;
        const leadLeft = leadRight - PIN_LEAD_LENGTH;
        const padLeft = leadLeft - PIN_PAD_LENGTH;
        return (
          <g key={`left-${i}`}>
            <rect x={padLeft} y={py - PIN_PAD_WIDTH / 2} width={PIN_PAD_LENGTH} height={PIN_PAD_WIDTH} fill={padColor} rx={0.5} />
            <line x1={leadLeft} y1={py} x2={leadRight} y2={py} stroke={pinColor} strokeWidth={PIN_LEAD_WIDTH} />
          </g>
        );
      } else {
        const leadLeft = bodyX + CHIP_W;
        const leadRight = leadLeft + PIN_LEAD_LENGTH;
        return (
          <g key={`right-${i}`}>
            <line x1={leadLeft} y1={py} x2={leadRight} y2={py} stroke={pinColor} strokeWidth={PIN_LEAD_WIDTH} />
            <rect x={leadRight} y={py - PIN_PAD_WIDTH / 2} width={PIN_PAD_LENGTH} height={PIN_PAD_WIDTH} fill={padColor} rx={0.5} />
          </g>
        );
      }
    });
  }

  return (
    <div style={{ position: 'relative', cursor: 'default' }}>
      <Handle type="target" position={Position.Right} id="right" style={{ visibility: 'hidden' }} />
      <svg width={svgW} height={svgH} viewBox={`0 0 ${svgW} ${svgH}`} style={{ display: 'block', overflow: 'visible' }}>
        {/* Gull-wing pins */}
        {renderSidePins('left')}
        {renderSidePins('right')}

        {/* Body */}
        <rect
          x={bodyX}
          y={0}
          width={CHIP_W}
          height={CHIP_H}
          fill={bodyColor}
          stroke={borderColor}
          strokeWidth={1}
          rx={2}
        />
        {active && (
          <rect
            x={bodyX}
            y={0}
            width={CHIP_W}
            height={CHIP_H}
            fill="none"
            stroke={pcb.signal.denied}
            strokeWidth={1}
            rx={2}
            opacity={0.3}
            filter="url(#pcb-glow-denied)"
          />
        )}

        {/* Pin-1 dot */}
        <circle cx={bodyX + 6} cy={6} r={2} fill={silkDim} opacity={0.5} />

        {/* "FAULT" silkscreen */}
        <text
          x={bodyX + CHIP_W / 2}
          y={14}
          textAnchor="middle"
          dominantBaseline="central"
          fill={silkColor}
          fontSize={9}
          fontFamily="'IBM Plex Mono', monospace"
          fontWeight={600}
          letterSpacing={1}
        >
          FAULT
        </text>

        {/* Denied count */}
        <text
          x={bodyX + CHIP_W / 2}
          y={30}
          textAnchor="middle"
          dominantBaseline="central"
          fill={active ? pcb.signal.denied : silkDim}
          fontSize={14}
          fontFamily="'IBM Plex Mono', monospace"
          fontWeight={700}
        >
          {deniedCount}
        </text>

        {/* 3 red LEDs across bottom */}
        {[0, 1, 2].map((i) => {
          const cx = bodyX + CHIP_W / 2 + (i - 1) * 14;
          const cy = CHIP_H - 6;
          const r = i === 1 ? 3.5 : 2.5;
          const ledColor = active ? pcb.component.ledRed : pcb.component.ledOff;
          return (
            <g key={`led-${i}`}>
              {active && (
                <circle cx={cx} cy={cy} r={r + 3} fill={pcb.component.ledRed} opacity={0.2} />
              )}
              <circle
                cx={cx}
                cy={cy}
                r={r}
                fill={ledColor}
                filter={active ? 'url(#pcb-glow-denied)' : undefined}
              />
            </g>
          );
        })}
      </svg>
    </div>
  );
});
DeniedBucketNode.displayName = 'DeniedBucketNode';
