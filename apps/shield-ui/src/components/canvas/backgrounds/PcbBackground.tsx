/**
 * Custom ReactFlow **node** that renders a realistic PCB circuit board aesthetic.
 * Registered as `canvas-pcb-background` and placed at the lowest zIndex so every
 * other node renders on top.  Because it is a proper node it pans and zooms with
 * the rest of the canvas — no manual viewport tracking required.
 *
 * Features:
 * - SVG patterns for solder pads, via pads, and faint trace lines
 * - Diverse procedurally-placed components using a seeded PRNG
 * - QFP IC packages, SOT-23 transistors, inductors, electrolytic caps,
 *   crystal oscillators, pin headers, mounting holes, fiducial markers
 * - Power bus traces, ground fill zones, silkscreen text, board edge
 * - Zone avoidance: central node area is kept clear
 */

import { useMemo, memo } from 'react';
import type { NodeProps } from '@xyflow/react';
import { useTheme } from '@mui/material/styles';
import { pcb } from '../styles/pcb-tokens';
import type { PcbBackgroundData } from '../Canvas.types';

/* ---- Seeded PRNG (Mulberry32) ---- */

function mulberry32(seed: number) {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ---- Component definitions ---- */

interface PlacedComponent {
  type: string;
  x: number;
  y: number;
  rotation: number;
  label: string;
}

function generateComponents(vw: number, vh: number): PlacedComponent[] {
  const rng = mulberry32(42);
  const components: PlacedComponent[] = [];

  // Zone avoidance: central node area (center 60% width, top 80% height)
  const avoidLeft = vw * 0.2;
  const avoidRight = vw * 0.8;
  const avoidTop = 0;
  const avoidBottom = vh * 0.8;

  function isInAvoidZone(x: number, y: number): boolean {
    return x > avoidLeft && x < avoidRight && y > avoidTop && y < avoidBottom;
  }

  function randomPos(): { x: number; y: number } {
    for (let attempt = 0; attempt < 20; attempt++) {
      const x = rng() * (vw - 40) + 20;
      const y = rng() * (vh - 40) + 20;
      if (!isInAvoidZone(x, y)) return { x, y };
    }
    // Fallback: place in bottom edge area
    return { x: rng() * vw, y: vh * 0.85 + rng() * (vh * 0.12) };
  }

  function randomRotation(): number {
    return [0, 90, 180, 270][Math.floor(rng() * 4)];
  }

  // SMD Resistors (R1-R8)
  for (let i = 1; i <= 8; i++) {
    const pos = randomPos();
    components.push({ type: 'resistor', ...pos, rotation: randomRotation(), label: `R${i}` });
  }

  // SMD Capacitors (C1-C8)
  for (let i = 1; i <= 8; i++) {
    const pos = randomPos();
    components.push({ type: 'capacitor', ...pos, rotation: randomRotation(), label: `C${i}` });
  }

  // Test points (TP1-TP4)
  for (let i = 1; i <= 4; i++) {
    const pos = randomPos();
    components.push({ type: 'testpoint', ...pos, rotation: 0, label: `TP${i}` });
  }

  // QFP IC packages (U1-U6)
  for (let i = 1; i <= 6; i++) {
    const pos = randomPos();
    components.push({ type: 'qfp', ...pos, rotation: randomRotation(), label: `U${i}` });
  }

  // SOT-23 transistors (Q1-Q4)
  for (let i = 1; i <= 4; i++) {
    const pos = randomPos();
    components.push({ type: 'sot23', ...pos, rotation: randomRotation(), label: `Q${i}` });
  }

  // Inductors (L1-L3)
  for (let i = 1; i <= 3; i++) {
    const pos = randomPos();
    components.push({ type: 'inductor', ...pos, rotation: randomRotation(), label: `L${i}` });
  }

  // Electrolytic caps (C10-C13)
  for (let i = 10; i <= 13; i++) {
    const pos = randomPos();
    components.push({ type: 'electrolytic', ...pos, rotation: 0, label: `C${i}` });
  }

  // Crystal oscillators (Y1-Y2)
  for (let i = 1; i <= 2; i++) {
    const pos = randomPos();
    components.push({ type: 'crystal', ...pos, rotation: randomRotation(), label: `Y${i}` });
  }

  // Pin headers/connectors (J1-J3)
  for (let i = 1; i <= 3; i++) {
    const pos = randomPos();
    const pinCount = 2 + Math.floor(rng() * 6); // 2-7 pins
    components.push({ type: `header-${pinCount}`, ...pos, rotation: randomRotation(), label: `J${i}` });
  }

  return components;
}

/* ---- Mounting hole positions (corners) ---- */
function getMountingHoles(vw: number, vh: number) {
  const inset = 30;
  return [
    { x: inset, y: inset, label: 'MH1' },
    { x: vw - inset, y: inset, label: 'MH2' },
    { x: inset, y: vh - inset, label: 'MH3' },
    { x: vw - inset, y: vh - inset, label: 'MH4' },
  ];
}

/* ---- Fiducial markers ---- */
function getFiducials(vw: number, vh: number) {
  return [
    { x: 60, y: 60 },
    { x: vw - 60, y: 60 },
    { x: 60, y: vh - 60 },
  ];
}

/* ---- Power bus traces ---- */
function getPowerBuses(vw: number, vh: number) {
  return [
    // Horizontal power rails
    { x1: 0, y1: vh * 0.15, x2: vw, y2: vh * 0.15 },
    { x1: 0, y1: vh * 0.88, x2: vw, y2: vh * 0.88 },
    // Vertical power rail
    { x1: vw * 0.08, y1: 0, x2: vw * 0.08, y2: vh },
  ];
}

export const PcbBackground = memo(({ data }: NodeProps) => {
  const { width: svgW, height: svgH } = data as unknown as PcbBackgroundData;
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';

  const baseColor = isDark ? pcb.board.base : pcb.light.base;
  const padColor = isDark ? pcb.trace.dimmed : pcb.trace.silver;
  const traceColor = isDark ? pcb.board.traceFaint : 'rgba(160, 160, 160, 0.15)';
  const viaColor = isDark ? pcb.via.ring : pcb.via.fill;
  const silkDim = isDark ? pcb.silk.dim : '#6A6A5A';
  const silkPrimary = isDark ? pcb.silk.primary : pcb.light.silk;
  const bodyColor = isDark ? pcb.component.body : pcb.light.body;
  const pinColor = pcb.component.pin;
  const padGold = pcb.component.padGold;

  // Memoize procedurally generated components
  const components = useMemo(() => generateComponents(svgW, svgH), [svgW, svgH]);
  const mountingHoles = useMemo(() => getMountingHoles(svgW, svgH), [svgW, svgH]);
  const fiducials = useMemo(() => getFiducials(svgW, svgH), [svgW, svgH]);
  const powerBuses = useMemo(() => getPowerBuses(svgW, svgH), [svgW, svgH]);

  return (
    <svg
      width={svgW}
      height={svgH}
      style={{ pointerEvents: 'none', display: 'block' }}
    >
      <defs>
        {/* Small solder pad grid — 24px spacing */}
        <pattern
          id="pcb-solder-pads"
          x={0}
          y={0}
          width={24}
          height={24}
          patternUnits="userSpaceOnUse"
        >
          <circle
            cx={12}
            cy={12}
            r={1.5}
            fill={padColor}
            opacity={0.3}
          />
        </pattern>

        {/* Larger via pads — 96px spacing */}
        <pattern
          id="pcb-via-pads"
          x={0}
          y={0}
          width={96}
          height={96}
          patternUnits="userSpaceOnUse"
        >
          <circle
            cx={48}
            cy={48}
            r={4}
            fill="none"
            stroke={viaColor}
            strokeWidth={1}
            opacity={0.2}
          />
          <circle
            cx={48}
            cy={48}
            r={2}
            fill={viaColor}
            opacity={0.15}
          />
        </pattern>

        {/* Faint trace lines — 48px spacing */}
        <pattern
          id="pcb-trace-lines"
          x={0}
          y={0}
          width={48}
          height={48}
          patternUnits="userSpaceOnUse"
        >
          <line
            x1={0} y1={0}
            x2={48} y2={0}
            stroke={traceColor}
            strokeWidth={0.5}
            opacity={0.4}
          />
          <line
            x1={0} y1={0}
            x2={0} y2={48}
            stroke={traceColor}
            strokeWidth={0.5}
            opacity={0.4}
          />
        </pattern>

        {/* Crosshatch pattern for ground fill zones */}
        <pattern
          id="pcb-crosshatch"
          width={8}
          height={8}
          patternUnits="userSpaceOnUse"
        >
          <line x1={0} y1={0} x2={8} y2={8}
            stroke={traceColor} strokeWidth={0.3} opacity={0.3} />
          <line x1={8} y1={0} x2={0} y2={8}
            stroke={traceColor} strokeWidth={0.3} opacity={0.3} />
        </pattern>
      </defs>

      {/* Base fill */}
      <rect width={svgW} height={svgH} fill={baseColor} />

      {/* Trace lines layer */}
      <rect width={svgW} height={svgH} fill="url(#pcb-trace-lines)" />

      {/* Solder pads layer */}
      <rect width={svgW} height={svgH} fill="url(#pcb-solder-pads)" />

      {/* Via pads layer */}
      <rect width={svgW} height={svgH} fill="url(#pcb-via-pads)" />

      {/* Board edge — dashed border rectangle */}
      <rect
        x={10}
        y={10}
        width={Math.max(0, svgW - 20)}
        height={Math.max(0, svgH - 20)}
        fill="none"
        stroke={silkDim}
        strokeWidth={0.8}
        strokeDasharray="4 3"
        opacity={0.25}
        rx={2}
      />

      {/* Power bus traces — thicker edge-to-edge lines */}
      <g opacity={0.15}>
        {powerBuses.map((bus, i) => (
          <line
            key={`power-${i}`}
            x1={bus.x1}
            y1={bus.y1}
            x2={bus.x2}
            y2={bus.y2}
            stroke={isDark ? '#444444' : '#999999'}
            strokeWidth={4}
          />
        ))}
      </g>

      {/* Ground fill zones — crosshatched rectangles in quiet corners */}
      <g opacity={0.15}>
        <rect
          x={15}
          y={svgH * 0.82}
          width={120}
          height={60}
          fill="url(#pcb-crosshatch)"
        />
        <rect
          x={svgW - 140}
          y={svgH * 0.82}
          width={120}
          height={60}
          fill="url(#pcb-crosshatch)"
        />
      </g>

      {/* Mounting holes (corners) */}
      <g opacity={0.3}>
        {mountingHoles.map((mh) => {
          const r = 10;
          return (
            <g key={mh.label}>
              <circle cx={mh.x} cy={mh.y} r={r} fill="none" stroke={viaColor} strokeWidth={1.5} />
              <circle cx={mh.x} cy={mh.y} r={r * 0.4} fill="none" stroke={viaColor} strokeWidth={0.8} />
              {/* Cross pattern */}
              <line x1={mh.x - r * 0.6} y1={mh.y} x2={mh.x + r * 0.6} y2={mh.y}
                stroke={viaColor} strokeWidth={0.5} />
              <line x1={mh.x} y1={mh.y - r * 0.6} x2={mh.x} y2={mh.y + r * 0.6}
                stroke={viaColor} strokeWidth={0.5} />
              <text x={mh.x + r + 3} y={mh.y + 2}
                fill={silkDim} fontSize={4}
                fontFamily="'IBM Plex Mono', monospace" opacity={0.7}>
                {mh.label}
              </text>
            </g>
          );
        })}
      </g>

      {/* Fiducial markers */}
      <g opacity={0.25}>
        {fiducials.map((f, i) => {
          const size = 4;
          return (
            <g key={`fid-${i}`}>
              <circle cx={f.x} cy={f.y} r={size} fill="none" stroke={padGold} strokeWidth={0.8} />
              <line x1={f.x - size} y1={f.y} x2={f.x + size} y2={f.y}
                stroke={padGold} strokeWidth={0.5} />
              <line x1={f.x} y1={f.y - size} x2={f.x} y2={f.y + size}
                stroke={padGold} strokeWidth={0.5} />
            </g>
          );
        })}
      </g>

      {/* Silkscreen text */}
      <g opacity={0.2}>
        <text
          x={50}
          y={22}
          fill={silkPrimary}
          fontSize={6}
          fontFamily="'IBM Plex Mono', monospace"
          letterSpacing={2}
          fontWeight={600}
        >
          AGENSHIELD MAIN BOARD
        </text>
        <text
          x={50}
          y={34}
          fill={silkDim}
          fontSize={4.5}
          fontFamily="'IBM Plex Mono', monospace"
          letterSpacing={1}
        >
          REV 2.0
        </text>
        <text
          x={svgW - 180}
          y={svgH - 18}
          fill={silkDim}
          fontSize={3.5}
          fontFamily="'IBM Plex Mono', monospace"
          letterSpacing={0.5}
        >
          {'\u00A9'} AGENSHIELD SYSTEMS
        </text>
      </g>

      {/* Decorative SMD components */}
      <g opacity={0.35}>
        {components.map((comp) => {
          return (
            <g key={comp.label} transform={`translate(${comp.x}, ${comp.y}) rotate(${comp.rotation})`}>
              {comp.type === 'resistor' && (
                <>
                  <rect x={0} y={0} width={12} height={5} fill={bodyColor} rx={0.5} />
                  <rect x={0} y={0} width={3} height={5} fill={pinColor} rx={0.5} />
                  <rect x={9} y={0} width={3} height={5} fill={pinColor} rx={0.5} />
                </>
              )}
              {comp.type === 'capacitor' && (
                <>
                  <rect x={0} y={0} width={8} height={6} fill={isDark ? '#8B7355' : '#C4A56A'} rx={0.5} />
                  <rect x={0} y={0} width={2} height={6} fill={pinColor} rx={0.5} />
                  <rect x={6} y={0} width={2} height={6} fill={pinColor} rx={0.5} />
                </>
              )}
              {comp.type === 'testpoint' && (
                <>
                  <circle cx={4} cy={4} r={4} fill="none" stroke={padGold} strokeWidth={1.5} />
                  <circle cx={4} cy={4} r={1.5} fill={padGold} />
                </>
              )}
              {comp.type === 'qfp' && (
                <>
                  {/* QFP IC body */}
                  <rect x={0} y={0} width={20} height={20} fill={bodyColor} rx={1} />
                  {/* Pins on 4 sides */}
                  {[0, 1, 2, 3, 4].map((p) => (
                    <g key={`pin-${p}`}>
                      {/* Top pins */}
                      <rect x={2 + p * 3.4} y={-3} width={1.5} height={3} fill={pinColor} />
                      {/* Bottom pins */}
                      <rect x={2 + p * 3.4} y={20} width={1.5} height={3} fill={pinColor} />
                      {/* Left pins */}
                      <rect x={-3} y={2 + p * 3.4} width={3} height={1.5} fill={pinColor} />
                      {/* Right pins */}
                      <rect x={20} y={2 + p * 3.4} width={3} height={1.5} fill={pinColor} />
                    </g>
                  ))}
                  {/* Orientation dot */}
                  <circle cx={3} cy={3} r={1.5} fill={silkDim} opacity={0.6} />
                </>
              )}
              {comp.type === 'sot23' && (
                <>
                  {/* SOT-23 transistor body */}
                  <rect x={0} y={0} width={6} height={4} fill={bodyColor} rx={0.5} />
                  {/* 3 pins */}
                  <rect x={0.5} y={-2} width={1} height={2} fill={pinColor} />
                  <rect x={4.5} y={-2} width={1} height={2} fill={pinColor} />
                  <rect x={2.5} y={4} width={1} height={2} fill={pinColor} />
                </>
              )}
              {comp.type === 'inductor' && (
                <>
                  {/* Inductor body */}
                  <rect x={0} y={0} width={10} height={8} fill={bodyColor} rx={1} />
                  {/* Coil marking */}
                  <path d="M2,4 Q3,2 4,4 Q5,6 6,4 Q7,2 8,4" fill="none" stroke={silkDim} strokeWidth={0.6} />
                  {/* Pads */}
                  <rect x={0} y={2} width={2} height={4} fill={pinColor} rx={0.3} />
                  <rect x={8} y={2} width={2} height={4} fill={pinColor} rx={0.3} />
                </>
              )}
              {comp.type === 'electrolytic' && (
                <>
                  {/* Electrolytic cap circle */}
                  <circle cx={8} cy={8} r={8} fill={bodyColor} />
                  <circle cx={8} cy={8} r={7} fill="none" stroke={silkDim} strokeWidth={0.5} opacity={0.5} />
                  {/* Polarity stripe */}
                  <path d="M1,4 Q0,8 1,12" fill="none" stroke={silkPrimary} strokeWidth={1} opacity={0.4} />
                  {/* + mark */}
                  <text x={5} y={6} fill={silkDim} fontSize={4} fontFamily="'IBM Plex Mono', monospace">+</text>
                </>
              )}
              {comp.type === 'crystal' && (
                <>
                  {/* Crystal oscillator — rounded rect */}
                  <rect x={0} y={0} width={12} height={6} fill={bodyColor} rx={2} />
                  <rect x={0} y={0} width={12} height={6} fill="none" stroke={pinColor} strokeWidth={0.5} rx={2} />
                  {/* Pads */}
                  <rect x={1} y={6} width={2} height={2} fill={pinColor} />
                  <rect x={9} y={6} width={2} height={2} fill={pinColor} />
                </>
              )}
              {comp.type.startsWith('header-') && (() => {
                const pinCount = parseInt(comp.type.split('-')[1]) || 4;
                return (
                  <>
                    {/* Pin header outline */}
                    <rect x={0} y={0} width={pinCount * 3.5 + 1} height={6}
                      fill="none" stroke={silkDim} strokeWidth={0.5} rx={0.3} />
                    {/* Individual pin pads */}
                    {Array.from({ length: pinCount }).map((_, p) => (
                      <rect key={p} x={1.5 + p * 3.5} y={1} width={2} height={4}
                        fill={padGold} rx={0.3} opacity={0.7} />
                    ))}
                  </>
                );
              })()}

              {/* Ref designator */}
              <text
                x={comp.type === 'testpoint' ? 12 : comp.type === 'qfp' ? 4 : comp.type === 'electrolytic' ? 4 : 14}
                y={comp.type === 'testpoint' ? 5 : comp.type === 'qfp' ? 13 : comp.type === 'electrolytic' ? 11 : 4}
                fill={silkDim}
                fontSize={comp.type === 'qfp' ? 4 : 5}
                fontFamily="'IBM Plex Mono', monospace"
                letterSpacing={0.5}
              >
                {comp.label}
              </text>
            </g>
          );
        })}
      </g>
    </svg>
  );
});
PcbBackground.displayName = 'PcbBackground';
