/**
 * EmptySlotNode — dashed PCI slot placeholder when no targets are detected.
 *
 * Shown below the system bus to indicate available expansion slots.
 */

import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Plus } from 'lucide-react';
import { useTheme } from '@mui/material/styles';
import { pcb } from '../../styles/pcb-tokens';

const PIN_TOTAL = 9; // same as other nodes

export const EmptySlotNode = memo(({ data }: NodeProps) => {
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';

  const w = 240;
  const h = 110;
  const svgW = w + PIN_TOTAL; // left pins area
  const bodyX = PIN_TOTAL;

  const silkDim = isDark ? pcb.silk.dim : '#6A6A5A';
  const borderColor = isDark ? 'rgba(136, 136, 136, 0.25)' : 'rgba(136, 136, 136, 0.3)';

  return (
    <div style={{ position: 'relative', cursor: 'default' }}>
      <Handle type="target" position={Position.Top} id="top" style={{ left: bodyX + w / 2, visibility: 'hidden' }} />
      <Handle type="target" position={Position.Left} id="left" style={{ visibility: 'hidden' }} />

      <svg width={svgW} height={h} viewBox={`0 0 ${svgW} ${h}`} style={{ display: 'block', overflow: 'visible' }}>
        {/* Dashed border body */}
        <rect
          x={bodyX}
          y={0}
          width={w}
          height={h}
          fill="none"
          stroke={borderColor}
          strokeWidth={1.5}
          strokeDasharray="6 4"
          rx={3}
        />

        {/* Dimmed gold connector fingers along top */}
        {Array.from({ length: 12 }, (_, i) => {
          const fingerW = (w - 24) / 14;
          return (
            <rect
              key={`finger-${i}`}
              x={bodyX + 12 + i * (fingerW + 2)}
              y={0}
              width={fingerW}
              height={7}
              fill={pcb.component.padGold}
              rx={1}
              opacity={0.25}
            />
          );
        })}

        {/* Plus icon */}
        <foreignObject x={bodyX + w / 2 - 16} y={h / 2 - 24} width={32} height={32}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
            <Plus size={24} color={silkDim} style={{ opacity: 0.4 }} />
          </div>
        </foreignObject>

        {/* Label: EMPTY SLOT */}
        <text
          x={bodyX + w / 2}
          y={h / 2 + 14}
          textAnchor="middle"
          dominantBaseline="central"
          fill={silkDim}
          fontSize={10}
          fontFamily="'IBM Plex Mono', monospace"
          fontWeight={600}
          letterSpacing={1}
          opacity={0.5}
        >
          EMPTY SLOT
        </text>

        {/* Sublabel */}
        <text
          x={bodyX + w / 2}
          y={h / 2 + 28}
          textAnchor="middle"
          dominantBaseline="central"
          fill={silkDim}
          fontSize={7}
          fontFamily="'IBM Plex Mono', monospace"
          opacity={0.4}
        >
          Add a target from the panel
        </text>
      </svg>
    </div>
  );
});
EmptySlotNode.displayName = 'EmptySlotNode';
