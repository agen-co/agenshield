/**
 * AgenShieldNode — central shield hub replacing BackplaneBus.
 *
 * A wide vertical PCB node that is the central element of the topology.
 * Connects UP to system components and LEFT/RIGHT to application cards.
 * Shielded apps connect through it; unshielded apps bypass it.
 *
 * Handles:
 *   - comp-{0..6}: source, Position.Top — connect UP to system components
 *   - left-{i}: source, Position.Left — connect to left-side cards
 *   - right-{i}: source, Position.Right — connect to right-side cards
 */

import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { useTheme } from '@mui/material/styles';
import { pcb } from '../../styles/pcb-tokens';
import type { AgenShieldData } from '../../Canvas.types';

/* ---- Dimensions ---- */
const SHIELD_W = 80;
const TOP_PAD = 30;
const ROW_SPACING = 200;

/* ---- Status LED colors ---- */
const STATUS_LED: Record<string, string> = {
  unprotected: pcb.component.ledRed,
  partial: pcb.component.ledAmber,
  protected: pcb.component.ledGreen,
};

/* ---- Status label ---- */
const STATUS_LABEL: Record<string, string> = {
  unprotected: 'UNPROTECTED',
  partial: 'PARTIAL',
  protected: 'PROTECTED',
};

export const AgenShieldNode = memo(({ data }: NodeProps) => {
  const {
    height: busHeight,
    leftHandleCount,
    rightHandleCount,
    status,
    shieldedCount,
    totalCount,
    compHandleXs = [],
    crossbarWidth = 0,
  } = data as unknown as AgenShieldData;

  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';

  const bodyColor = isDark ? '#151518' : '#E8E8E0';
  const borderClr = status === 'protected'
    ? 'rgba(45,107,63,0.5)'
    : status === 'partial'
      ? 'rgba(238,164,95,0.4)'
      : 'rgba(136,136,136,0.4)';
  const silkColor = isDark ? pcb.silk.dim : '#6A6A5A';
  const padColor = pcb.component.padGold;
  const traceClr = status === 'unprotected'
    ? '#E1583E'
    : '#2D6B3F';
  const ledColor = STATUS_LED[status] ?? pcb.component.ledRed;
  const hasProfiles = leftHandleCount > 0 || rightHandleCount > 0;

  /* ---- Trace line X positions ---- */
  const traceXs = [0.12, 0.27, 0.42, 0.58, 0.73, 0.88].map((p) => p * SHIELD_W);

  /* ---- Handle Y positions ---- */
  const handleY = (i: number) => TOP_PAD + i * ROW_SPACING;

  /* ---- Via pad positions (decorative) ---- */
  const vias = [
    { x: 12, y: 16 },
    { x: SHIELD_W - 12, y: 16 },
    { x: SHIELD_W / 2, y: busHeight - 16 },
    { x: 12, y: busHeight - 16 },
    { x: SHIELD_W - 12, y: busHeight - 16 },
  ];

  /* ---- Logo dimensions ---- */
  const logoSize = 22;
  const logoX = SHIELD_W / 2 - logoSize / 2;
  const logoY = 4;

  return (
    <div style={{ position: 'relative', cursor: 'default' }}>
      {/* Component connection handles along top — 2 per component, 4px gap */}
      {compHandleXs.map((hx, i) => (
        <Handle
          key={`comp-in-${i}`}
          type="target"
          position={Position.Top}
          id={`comp-in-${i}`}
          style={{ left: hx - 2, visibility: 'hidden' }}
        />
      ))}
      {compHandleXs.map((hx, i) => (
        <Handle
          key={`comp-out-${i}`}
          type="source"
          position={Position.Top}
          id={`comp-out-${i}`}
          style={{ left: hx + 2, visibility: 'hidden' }}
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
        width={SHIELD_W}
        height={busHeight}
        viewBox={`0 0 ${SHIELD_W} ${busHeight}`}
        style={{ display: 'block', overflow: 'visible' }}
      >
        {/* === Body === */}
        <rect
          x={0} y={0} width={SHIELD_W} height={busHeight}
          fill={bodyColor} stroke={borderClr} strokeWidth={1.5} rx={3}
        />
        <rect
          x={0} y={0} width={SHIELD_W} height={busHeight}
          fill="url(#pcb-chip-gradient)" rx={3} opacity={0.3}
        />

        {/* === Green glow border when protected === */}
        {status === 'protected' && (
          <rect
            x={-1} y={-1} width={SHIELD_W + 2} height={busHeight + 2}
            fill="none" stroke="#2D6B3F" strokeWidth={0.8} rx={4}
            opacity={0.25}
            style={{ animation: 'shield-trace-pulse 3s ease-in-out infinite' }}
          />
        )}

        {/* === T-Shape Crossbar (spanning all component positions) === */}
        {compHandleXs.length > 0 && (() => {
          const cbLeft = compHandleXs[0] - 10;
          const cbRight = compHandleXs[compHandleXs.length - 1] + 10;
          const cbW = cbRight - cbLeft;
          const cbH = 16;
          const pinH = 8;
          const pinW = 3;
          const pinSpacing = 2;

          return (
            <g>
              {/* Crossbar body */}
              <rect x={cbLeft} y={-cbH} width={cbW} height={cbH}
                fill={bodyColor} stroke={borderClr} strokeWidth={1} rx={2} />
              <rect x={cbLeft} y={-cbH} width={cbW} height={cbH}
                fill="url(#pcb-chip-gradient)" opacity={0.3} rx={2} />

              {/* Internal horizontal traces */}
              {[0.25, 0.5, 0.75].map((frac) => (
                <line key={`cbt-${frac}`}
                  x1={cbLeft + 4} y1={-cbH + cbH * frac}
                  x2={cbRight - 4} y2={-cbH + cbH * frac}
                  stroke={traceClr} strokeWidth={0.6} opacity={0.2} />
              ))}

              {/* Pin stubs at each component position (2 per component) */}
              {compHandleXs.map((hx, i) => (
                <g key={`pin-${i}`}>
                  {/* Left pin (incoming) */}
                  <rect x={hx - pinSpacing - pinW / 2} y={-cbH - pinH}
                    width={pinW} height={pinH} fill={padColor} rx={0.5} opacity={0.8} />
                  {/* Right pin (outgoing) */}
                  <rect x={hx + pinSpacing - pinW / 2} y={-cbH - pinH}
                    width={pinW} height={pinH} fill={padColor} rx={0.5} opacity={0.8} />
                  {/* Traces from pins into crossbar */}
                  <line x1={hx - pinSpacing} y1={-cbH} x2={hx - pinSpacing} y2={-cbH + 4}
                    stroke={traceClr} strokeWidth={0.5} opacity={0.25} />
                  <line x1={hx + pinSpacing} y1={-cbH} x2={hx + pinSpacing} y2={-cbH + 4}
                    stroke={traceClr} strokeWidth={0.5} opacity={0.25} />
                </g>
              ))}

              {/* Wing connections from crossbar to stem */}
              <line x1={SHIELD_W / 2 - SHIELD_W / 4} y1={0} x2={cbLeft + 10} y2={-1}
                stroke={borderClr} strokeWidth={1} />
              <line x1={SHIELD_W / 2 + SHIELD_W / 4} y1={0} x2={cbRight - 10} y2={-1}
                stroke={borderClr} strokeWidth={1} />
            </g>
          );
        })()}

        {/* === Logo (favicon.svg) === */}
        <image
          href="/favicon.svg"
          x={logoX} y={logoY}
          width={logoSize} height={logoSize}
          opacity={0.85}
        />

        {/* === Status LED (top-right) === */}
        <g>
          <circle cx={SHIELD_W - 12} cy={12} r={6} fill={ledColor} opacity={0.2}
            style={{ animation: 'pcb-led-glow-breathe 2s ease-in-out infinite' }} />
          <rect x={SHIELD_W - 15} y={10} width={6} height={3}
            fill={isDark ? pcb.component.bodyLight : '#e0e0d8'}
            stroke="rgba(80,80,80,0.2)" strokeWidth={0.3} rx={0.5} />
          <rect x={SHIELD_W - 14} y={10.5} width={4} height={2}
            fill={ledColor} rx={0.5} opacity={0.85}
            style={{ animation: 'pcb-led-pulse 2s ease-in-out infinite' }} />
        </g>

        {/* === Vertical trace lines (internal bus) === */}
        <g opacity={status === 'unprotected' ? 0.25 : 0.3} stroke={traceClr} fill="none">
          {traceXs.map((tx, i) => (
            <line
              key={`vt-${i}`}
              x1={tx} y1={28} x2={tx} y2={busHeight - 14}
              strokeWidth={i % 2 === 0 ? 1.2 : 0.8}
            />
          ))}
        </g>

        {/* === Red overlay traces (when unprotected) === */}
        {status === 'unprotected' && (
          <g opacity={0.2} stroke="#E1583E" fill="none"
            style={{ animation: 'danger-wire-pulse 2s ease-in-out infinite' }}>
            {traceXs.map((tx, i) => (
              <line key={`dt-${i}`} x1={tx} y1={28} x2={tx} y2={busHeight - 14}
                strokeWidth={i % 2 === 0 ? 1.4 : 1} />
            ))}
          </g>
        )}

        {/* === Left connection pads === */}
        {Array.from({ length: leftHandleCount }, (_, i) => {
          const py = handleY(i);
          return (
            <g key={`lp-${i}`}>
              <rect
                x={0} y={py - 3} width={5} height={6}
                fill={padColor} rx={0.5} opacity={0.8}
              />
              <line
                x1={-3} y1={py} x2={0} y2={py}
                stroke={padColor} strokeWidth={1} opacity={0.6}
              />
              <line
                x1={5} y1={py} x2={SHIELD_W / 2} y2={py}
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
              <rect
                x={SHIELD_W - 5} y={py - 3} width={5} height={6}
                fill={padColor} rx={0.5} opacity={0.8}
              />
              <line
                x1={SHIELD_W} y1={py} x2={SHIELD_W + 3} y2={py}
                stroke={padColor} strokeWidth={1} opacity={0.6}
              />
              <line
                x1={SHIELD_W / 2} y1={py} x2={SHIELD_W - 5} y2={py}
                stroke={traceClr} strokeWidth={0.6} opacity={0.15}
              />
            </g>
          );
        })}

        {/* === Via pads (decorative) === */}
        {vias.map((v, i) => (
          <g key={`v-${i}`}>
            <circle cx={v.x} cy={v.y} r={2.5} fill="none"
              stroke={pcb.via.ring} strokeWidth={0.8} opacity={0.45} />
            <circle cx={v.x} cy={v.y} r={1} fill={pcb.via.fill} opacity={0.45} />
          </g>
        ))}

        {/* === Silkscreen label (rotated, along right edge) === */}
        <text
          x={SHIELD_W - 4} y={busHeight / 2}
          textAnchor="middle"
          dominantBaseline="central"
          fill={silkColor}
          fontSize={5}
          fontFamily="'IBM Plex Mono', monospace"
          letterSpacing={1.5}
          opacity={0.5}
          transform={`rotate(90, ${SHIELD_W - 4}, ${busHeight / 2})`}
        >
          AGENSHIELD
        </text>

        {/* === Status text (small silkscreen below logo) === */}
        <text
          x={SHIELD_W / 2} y={28}
          textAnchor="middle"
          dominantBaseline="central"
          fill={status === 'protected' ? '#2D6B3F' : status === 'partial' ? '#EEA45F' : '#E1583E'}
          fontSize={3.5}
          fontFamily="'IBM Plex Mono', monospace"
          letterSpacing={0.5}
          opacity={0.7}
        >
          {STATUS_LABEL[status] ?? 'UNKNOWN'}
        </text>

        {/* === Count indicator === */}
        {totalCount > 0 && (
          <text
            x={SHIELD_W / 2} y={34}
            textAnchor="middle"
            dominantBaseline="central"
            fill={silkColor}
            fontSize={3}
            fontFamily="'IBM Plex Mono', monospace"
            opacity={0.5}
          >
            {shieldedCount}/{totalCount}
          </text>
        )}

        {/* === Empty state placeholder === */}
        {!hasProfiles && (
          <g>
            <rect
              x={6} y={busHeight / 2 - 20} width={SHIELD_W - 12} height={40}
              fill="none" stroke={silkColor} strokeWidth={0.8}
              strokeDasharray="4 2" rx={2} opacity={0.4}
            />
            <text
              x={SHIELD_W / 2} y={busHeight / 2 - 4}
              textAnchor="middle" dominantBaseline="central"
              fill={silkColor} fontSize={5}
              fontFamily="'IBM Plex Mono', monospace"
              opacity={0.5}
            >
              NO
            </text>
            <text
              x={SHIELD_W / 2} y={busHeight / 2 + 6}
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
AgenShieldNode.displayName = 'AgenShieldNode';
