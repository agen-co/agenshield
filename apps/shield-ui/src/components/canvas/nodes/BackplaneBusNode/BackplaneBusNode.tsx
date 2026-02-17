/**
 * BackplaneBusNode — vertical backplane bus strip.
 *
 * A central vertical PCB bus that connects the SystemBoard to ApplicationCards.
 * Cards plug in from left and right sides. Dynamic height based on handle count.
 *
 * Handles:
 *   - top: target (from board)
 *   - left-{i}: source (to left-side cards)
 *   - right-{i}: source (to right-side cards)
 */

import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { useTheme } from '@mui/material/styles';
import { pcb } from '../../styles/pcb-tokens';
import type { BackplaneBusData } from '../../Canvas.types';

/* ---- Dimensions ---- */
const BUS_W = 60;
const BUS_TOP_PAD = 30;
const ROW_SPACING = 200;

/* ---- Pin / pad proportions ---- */
const PAD_W = 3;
const PAD_L = 4;

/* ---- Status LED colors ---- */
const STATUS_LED: Record<string, string> = {
  unprotected: pcb.component.ledRed,
  partial: pcb.component.ledAmber,
  protected: pcb.component.ledGreen,
};

export const BackplaneBusNode = memo(({ data }: NodeProps) => {
  const {
    height: busHeight,
    leftHandleCount,
    rightHandleCount,
    status,
  } = data as unknown as BackplaneBusData;

  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';

  const bodyColor = isDark ? pcb.board.solderMask : '#EDEDDF';
  const borderClr = 'rgba(136,136,136,0.4)';
  const silkColor = isDark ? pcb.silk.dim : '#6A6A5A';
  const padColor = pcb.component.padGold;
  const traceClr = isDark ? pcb.trace.silver : '#888888';
  const ledColor = STATUS_LED[status] ?? pcb.component.ledRed;
  const hasProfiles = leftHandleCount > 0 || rightHandleCount > 0;

  /* ---- Trace line X positions (decorative internal bus traces) ---- */
  const traceXs = [0.15, 0.30, 0.50, 0.70, 0.85].map((p) => p * BUS_W);

  /* ---- Handle Y positions ---- */
  const handleY = (i: number) => BUS_TOP_PAD + i * ROW_SPACING;

  /* ---- Via pad positions (decorative) ---- */
  const vias = [
    { x: 12, y: 14 },
    { x: BUS_W - 12, y: 14 },
    { x: BUS_W / 2, y: busHeight - 14 },
    { x: 12, y: busHeight - 14 },
    { x: BUS_W - 12, y: busHeight - 14 },
  ];

  return (
    <div style={{ position: 'relative', cursor: 'default' }}>
      {/* Top handle — from board */}
      <Handle
        type="target"
        position={Position.Top}
        id="top"
        style={{ left: BUS_W / 2, visibility: 'hidden' }}
      />

      {/* Component connection handles along top (for system component nodes above) */}
      {Array.from({ length: 7 }, (_, i) => (
        <Handle
          key={`comp-${i}`}
          type="source"
          position={Position.Top}
          id={`comp-${i}`}
          style={{ left: 8 + i * 7, visibility: 'hidden' }}
        />
      ))}

      {/* Left handles */}
      {Array.from({ length: leftHandleCount }, (_, i) => (
        <Handle
          key={`left-${i}`}
          type="source"
          position={Position.Left}
          id={`left-${i}`}
          style={{ top: handleY(i), visibility: 'hidden' }}
        />
      ))}

      {/* Right handles */}
      {Array.from({ length: rightHandleCount }, (_, i) => (
        <Handle
          key={`right-${i}`}
          type="source"
          position={Position.Right}
          id={`right-${i}`}
          style={{ top: handleY(i), visibility: 'hidden' }}
        />
      ))}

      <svg
        width={BUS_W}
        height={busHeight}
        viewBox={`0 0 ${BUS_W} ${busHeight}`}
        style={{ display: 'block', overflow: 'visible' }}
      >
        {/* === Bus body === */}
        <rect
          x={0} y={0} width={BUS_W} height={busHeight}
          fill={bodyColor} stroke={borderClr} strokeWidth={1.5} rx={3}
        />
        <rect
          x={0} y={0} width={BUS_W} height={busHeight}
          fill="url(#pcb-chip-gradient)" rx={3} opacity={0.3}
        />

        {/* === Top connector cluster (from board) === */}
        <rect x={BUS_W / 2 - 10} y={0} width={20} height={8} fill={padColor} rx={1} opacity={0.8} />
        {Array.from({ length: 4 }, (_, i) => (
          <rect
            key={`tc-${i}`}
            x={BUS_W / 2 - 8 + i * 5}
            y={8}
            width={2}
            height={4}
            fill={padColor}
            rx={0.3}
            opacity={0.6}
          />
        ))}

        {/* === Vertical trace lines (decorative internal bus) === */}
        <g opacity={0.2} stroke={traceClr} fill="none">
          {traceXs.map((tx, i) => (
            <line
              key={`vt-${i}`}
              x1={tx} y1={14} x2={tx} y2={busHeight - 14}
              strokeWidth={i === 2 ? 1.2 : 0.8}
            />
          ))}
        </g>

        {/* === Red overlay traces (when unprotected) === */}
        {status === 'unprotected' && (
          <g opacity={0.3} stroke="#E1583E" fill="none"
            style={{ animation: 'danger-wire-pulse 2s ease-in-out infinite' }}>
            {traceXs.map((tx, i) => (
              <line key={`dt-${i}`} x1={tx} y1={14} x2={tx} y2={busHeight - 14}
                strokeWidth={i === 2 ? 1.4 : 1} />
            ))}
          </g>
        )}

        {/* === Left connection pads === */}
        {Array.from({ length: leftHandleCount }, (_, i) => {
          const py = handleY(i);
          return (
            <g key={`lp-${i}`}>
              {/* Pad */}
              <rect
                x={0} y={py - PAD_W} width={PAD_L + 1} height={PAD_W * 2}
                fill={padColor} rx={0.5} opacity={0.8}
              />
              {/* Lead stub */}
              <line
                x1={-3} y1={py} x2={0} y2={py}
                stroke={padColor} strokeWidth={1} opacity={0.6}
              />
              {/* Horizontal trace to center */}
              <line
                x1={PAD_L + 1} y1={py} x2={BUS_W / 2} y2={py}
                stroke={traceClr} strokeWidth={0.6} opacity={0.15}
              />
            </g>
          );
        })}

        {/* === Right connection pads === */}
        {Array.from({ length: rightHandleCount }, (_, i) => {
          const py = handleY(i);
          return (
            <g key={`rp-${i}`}>
              {/* Pad */}
              <rect
                x={BUS_W - PAD_L - 1} y={py - PAD_W} width={PAD_L + 1} height={PAD_W * 2}
                fill={padColor} rx={0.5} opacity={0.8}
              />
              {/* Lead stub */}
              <line
                x1={BUS_W} y1={py} x2={BUS_W + 3} y2={py}
                stroke={padColor} strokeWidth={1} opacity={0.6}
              />
              {/* Horizontal trace to center */}
              <line
                x1={BUS_W / 2} y1={py} x2={BUS_W - PAD_L - 1} y2={py}
                stroke={traceClr} strokeWidth={0.6} opacity={0.15}
              />
            </g>
          );
        })}

        {/* === Status LED === */}
        <g>
          <circle cx={BUS_W - 10} cy={10} r={5} fill={ledColor} opacity={0.2}
            style={{ animation: 'pcb-led-glow-breathe 2s ease-in-out infinite' }} />
          <rect x={BUS_W - 13} y={8} width={6} height={3}
            fill={isDark ? pcb.component.bodyLight : '#e0e0d8'}
            stroke="rgba(80,80,80,0.2)" strokeWidth={0.3} rx={0.5} />
          <rect x={BUS_W - 12} y={8.5} width={4} height={2}
            fill={ledColor} rx={0.5} opacity={0.85}
            style={{ animation: 'pcb-led-pulse 2s ease-in-out infinite' }} />
        </g>

        {/* === Via pads (decorative) === */}
        {vias.map((v, i) => (
          <g key={`v-${i}`}>
            <circle cx={v.x} cy={v.y} r={2.5} fill="none"
              stroke={pcb.via.ring} strokeWidth={0.8} opacity={0.45} />
            <circle cx={v.x} cy={v.y} r={1} fill={pcb.via.fill} opacity={0.45} />
          </g>
        ))}

        {/* === Silkscreen label (rotated 90 degrees along right edge) === */}
        <text
          x={BUS_W - 4} y={busHeight / 2}
          textAnchor="middle"
          dominantBaseline="central"
          fill={silkColor}
          fontSize={5}
          fontFamily="'IBM Plex Mono', monospace"
          letterSpacing={1}
          opacity={0.5}
          transform={`rotate(90, ${BUS_W - 4}, ${busHeight / 2})`}
        >
          BACKPLANE BUS
        </text>

        {/* === Empty state placeholder === */}
        {!hasProfiles && (
          <g>
            <rect
              x={6} y={busHeight / 2 - 20} width={BUS_W - 12} height={40}
              fill="none" stroke={silkColor} strokeWidth={0.8}
              strokeDasharray="4 2" rx={2} opacity={0.4}
            />
            <text
              x={BUS_W / 2} y={busHeight / 2 - 4}
              textAnchor="middle" dominantBaseline="central"
              fill={silkColor} fontSize={5}
              fontFamily="'IBM Plex Mono', monospace"
              opacity={0.5}
            >
              NO
            </text>
            <text
              x={BUS_W / 2} y={busHeight / 2 + 6}
              textAnchor="middle" dominantBaseline="central"
              fill={silkColor} fontSize={5}
              fontFamily="'IBM Plex Mono', monospace"
              opacity={0.5}
            >
              PROFILES
            </text>
          </g>
        )}
      </svg>
    </div>
  );
});
BackplaneBusNode.displayName = 'BackplaneBusNode';
