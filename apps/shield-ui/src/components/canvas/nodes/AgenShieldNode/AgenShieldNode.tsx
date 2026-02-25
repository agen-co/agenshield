/**
 * AgenShieldNode — central 4-piece shield logo hub.
 *
 * Renders the shield from favicon.svg split into 4 natural pieces
 * (rightWing, centerBody, leftWing, horizontalBar) with colored seam
 * lines between them. Status determines seam color; daemonRunning
 * determines fill brightness, breathing animation, and wing state.
 *
 * Wings are always open — shield always renders with expanded wings and
 * left/right sections visible.
 *
 * Handle zones (dynamic arrays):
 *   - topHandles: core component connections (5)
 *   - bottomHandles: broker connections (N)
 *   - leftHandles: left auxiliary connections (2+)
 *   - rightHandles: right auxiliary connections (2+)
 */

import { memo, useState } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { useTheme } from '@mui/material/styles';
import type { AgenShieldData } from '../../Canvas.types';

/* ---- Shield piece paths (from favicon.svg, viewBox 0 0 200 200) ---- */
const SHIELD_PIECES = {
  rightWing:
    'M 178.798 107.411 C 178.798 118.959 176.902 129.153 173.471 138.178 L 134.526 15.616 L 172.298 29.106 C 176.227 30.523 178.838 34.276 178.797 38.472 Z',
  centerBody:
    'M 103.352 195.559 C 101.208 196.284 98.873 196.251 96.746 195.467 C 75.186 188.023 55.443 177.699 41.552 162.446 L 58.293 109.251 L 90.886 6.575 L 96.746 4.482 C 98.89 3.732 101.217 3.732 103.352 4.482 L 109.146 6.551 L 141.712 109.251 L 158.453 162.461 C 144.573 177.722 124.857 188.068 103.352 195.559 Z',
  leftWing:
    'M 21.202 107.411 L 21.202 38.472 C 21.177 34.252 23.837 30.498 27.808 29.106 L 65.46 15.657 L 26.529 138.176 C 23.097 129.153 21.202 118.959 21.202 107.411 Z',
  horizontalBar: 'M 123.914 83.6 L 76.29 83.6 L 69.627 102.624 L 130.07 102.624 Z',
};

/* ---- Seam lines (gap paths between pieces) ---- */
const SEAM_LINES = {
  leftDiagonal: 'M 90.885 6.601 L 58.292 109.277 L 41.551 162.472',
  rightDiagonal: 'M 109.145 6.577 L 141.711 109.277 L 158.453 162.487',
  barTop: 'M 76.29 83.6 L 123.914 83.6',
  barBottom: 'M 69.627 102.624 L 130.07 102.624',
};

/* ---- Status → seam color ---- */
const SEAM_COLORS: Record<string, string> = {
  unprotected: '#E1583E',
  partial: '#EEA45F',
  protected: '#2D6B3F',
};

/* ---- Status label ---- */
const STATUS_LABEL: Record<string, string> = {
  unprotected: 'UNPROTECTED',
  partial: 'PARTIAL',
  protected: 'PROTECTED',
};

/* ---- Wing animation constants ---- */
const WING_CLOSED_LEFT = 'translate(25px, -9px)';
const WING_CLOSED_RIGHT = 'translate(-25px, -9px)';
const WING_OPEN = 'translate(0, 0)';
const WING_TRANSITION = 'transform 0.8s ease-in-out, opacity 0.8s ease-in-out';

export const AgenShieldNode = memo(({ data }: NodeProps) => {
  const {
    width,
    height,
    status,
    daemonRunning,
    shieldedCount,
    totalCount,
    updateAvailable,
    topHandles = [],
    bottomHandles = [],
    leftHandles = [],
    rightHandles = [],
  } = data as unknown as AgenShieldData;

  const [hovered, setHovered] = useState(false);

  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';

  // Wings are always open — shield always renders with expanded wings
  const wingsOpen = true;

  const fillColor = daemonRunning
    ? (isDark ? '#EDEDED' : '#171717')
    : (isDark ? '#333' : '#BBB');

  const seamColor = SEAM_COLORS[status] ?? '#E1583E';
  const seamGlow = status === 'protected' ? 'url(#shield-trace-glow)' : undefined;
  const statusTextColor = status === 'protected'
    ? '#2D6B3F'
    : status === 'partial'
      ? '#EEA45F'
      : '#E1583E';

  // Shield is dimmed when daemon is off
  const shieldOpacity = daemonRunning ? 1 : 0.6;

  // Status label logic
  const statusLabel = daemonRunning
    ? (STATUS_LABEL[status] ?? 'UNKNOWN')
    : totalCount === 0
      ? 'NOT INSTALLED'
      : 'OFFLINE';

  return (
    <div
      style={{
        position: 'relative',
        cursor: 'pointer',
        transition: 'filter 0.2s ease, opacity 0.6s ease-in-out',
        filter: hovered ? 'brightness(1.05)' : 'none',
        opacity: shieldOpacity,
        overflow: 'visible',
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* ---- ALL HANDLES: unified renderer with x/y contour support ---- */}
      {[...topHandles, ...bottomHandles, ...leftHandles, ...rightHandles].map((h) => (
        <Handle
          key={h.id}
          type={h.type}
          position={h.position}
          id={h.id}
          style={{
            ...(h.x != null && h.y != null
              ? { left: h.x, top: h.y }
              : h.position === Position.Left || h.position === Position.Right
                ? { top: h.offset }
                : { left: h.offset }),
            visibility: 'hidden',
          }}
        />
      ))}

      <svg
        width={width}
        height={height}
        viewBox="0 0 200 200"
        style={{ display: 'block', overflow: 'visible' }}
      >
        {/* === Shield group with breathing animation === */}
        <g
          style={{
            transformOrigin: '100px 100px',
            ...(daemonRunning
              ? { animation: 'shield-breathe 4s ease-in-out infinite' }
              : {}),
          }}
        >
          {/* Center body — always stationary */}
          <path d={SHIELD_PIECES.centerBody} fill={fillColor} />
          <path d={SHIELD_PIECES.horizontalBar} fill={fillColor} />

          {/* Left wing — slides right+up when closed */}
          <g style={{
            transform: wingsOpen ? WING_OPEN : WING_CLOSED_LEFT,
            transition: WING_TRANSITION,
          }}>
            <path d={SHIELD_PIECES.leftWing} fill={fillColor} />
          </g>

          {/* Right wing — slides left+up when closed */}
          <g style={{
            transform: wingsOpen ? WING_OPEN : WING_CLOSED_RIGHT,
            transition: WING_TRANSITION,
          }}>
            <path d={SHIELD_PIECES.rightWing} fill={fillColor} />
          </g>

          {/* Seam lines */}
          <path
            d={SEAM_LINES.leftDiagonal}
            fill="none"
            stroke={seamColor}
            strokeWidth={1.8}
            strokeLinecap="round"
            filter={seamGlow}
          />
          <path
            d={SEAM_LINES.rightDiagonal}
            fill="none"
            stroke={seamColor}
            strokeWidth={1.8}
            strokeLinecap="round"
            filter={seamGlow}
          />
          <path
            d={SEAM_LINES.barTop}
            fill="none"
            stroke={seamColor}
            strokeWidth={1.8}
            strokeLinecap="round"
            filter={seamGlow}
          />
          <path
            d={SEAM_LINES.barBottom}
            fill="none"
            stroke={seamColor}
            strokeWidth={1.8}
            strokeLinecap="round"
            filter={seamGlow}
          />
        </g>

        {/* === Status text below shield center === */}
        <text
          x={100}
          y={170}
          textAnchor="middle"
          dominantBaseline="central"
          fill={statusTextColor}
          fontSize={7}
          fontFamily="'IBM Plex Mono', monospace"
          letterSpacing={1}
          opacity={0.8}
        >
          {statusLabel}
        </text>

        {/* === Count indicator === */}
        {totalCount > 0 && (
          <text
            x={100}
            y={182}
            textAnchor="middle"
            dominantBaseline="central"
            fill={isDark ? '#888' : '#666'}
            fontSize={6}
            fontFamily="'IBM Plex Mono', monospace"
            opacity={0.6}
          >
            {shieldedCount}/{totalCount}
          </text>
        )}

        {/* === Update badge — only when a new version is available === */}
        {updateAvailable && (
          <g style={{ cursor: 'pointer' }}>
            <rect
              x={75} y={186} width={50} height={14} rx={3}
              fill="#6BAEF2" opacity={0.9}
            />
            <text
              x={100} y={193}
              textAnchor="middle" dominantBaseline="central"
              fill="#fff" fontSize={7} fontWeight={700}
              fontFamily="'IBM Plex Mono', monospace" letterSpacing={0.5}
            >
              UPDATE
            </text>
          </g>
        )}
      </svg>
    </div>
  );
});
AgenShieldNode.displayName = 'AgenShieldNode';
