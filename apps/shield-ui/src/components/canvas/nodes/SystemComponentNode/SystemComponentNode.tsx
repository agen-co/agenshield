/**
 * SystemComponentNode — production-grade PCB component chip for each system resource.
 *
 * 7 variants: cpu, network, command, filesystem, memory, monitoring, logs.
 * Each has a large, detailed physical design with realistic IC renders,
 * properly connected gull-wing legs, inner outlined alerts/LEDs.
 *
 * Live metrics displayed inside each chip variant:
 *   - CPU: horizontal bar gauge
 *   - Memory: fill level on DIMM modules
 *   - Network: ↑↓ throughput indicators
 *   - Filesystem: arc gauge around platter
 *   - Command: blinking cursor speed
 *   - Monitoring: bar heights reflect usage
 *   - Logs: line opacity pulses with activity
 *
 * Handles:
 *   - bottom (source): connects down to AgenShield
 *   - left (target): incoming danger wires from right-side apps
 *   - right (target): incoming danger wires from left-side apps
 */

import React, { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { useTheme } from '@mui/material/styles';
import { useSnapshot } from 'valtio';
import { pcb } from '../../styles/pcb-tokens';
import { systemMetricsStore } from '../../../../state/system-metrics';
import type { SystemComponentData, SystemComponentType, SystemMetrics } from '../../Canvas.types';

/* ---- Variant definitions ---- */
interface VariantDef {
  w: number;
  h: number;
  render: (ctx: RenderCtx) => React.JSX.Element;
}

interface RenderCtx {
  w: number;
  h: number;
  isDark: boolean;
  chipBody: string;
  chipBorder: string;
  padColor: string;
  pinColor: string;
  traceClr: string;
  silkColor: string;
  silkDim: string;
  exposed: boolean;
  metrics: SystemMetrics;
}

/* ---- Default metrics (used when none provided) ---- */
const DEFAULT_METRICS: SystemMetrics = {
  cpuPercent: 0, memPercent: 0, diskPercent: 0,
  netUp: 0, netDown: 0, cmdRate: 0, logRate: 0,
};

/* ---- Pin dimensions ---- */
const PAD_W = 3.5;
const PAD_L = 4;
const LEAD_W = 1;
const GULL_DROP = 2.5;   // vertical drop of the gull-wing bend

/** Gull-wing QFP pins on left and right sides with proper L-shaped bends */
function qfpPins(
  ic: { x: number; y: number; w: number; h: number },
  sideCount: number,
  padColor: string,
  pinColor: string,
): React.JSX.Element[] {
  const els: React.JSX.Element[] = [];
  const spacing = (ic.h - 12) / Math.max(sideCount - 1, 1);
  for (let i = 0; i < sideCount; i++) {
    const py = ic.y + 6 + i * spacing;
    // Left gull-wing: horizontal lead → bend down → pad
    els.push(
      <g key={`l${i}`}>
        <rect x={ic.x - PAD_L} y={py - PAD_W / 2} width={PAD_L} height={PAD_W} fill={padColor} rx={0.5} />
        <path
          d={`M ${ic.x - PAD_L - 7} ${py - GULL_DROP} L ${ic.x - PAD_L - 3} ${py - GULL_DROP} L ${ic.x - PAD_L - 1} ${py} L ${ic.x - PAD_L} ${py}`}
          stroke={pinColor} strokeWidth={LEAD_W} fill="none" strokeLinejoin="round"
        />
      </g>,
    );
    // Right gull-wing
    els.push(
      <g key={`r${i}`}>
        <rect x={ic.x + ic.w} y={py - PAD_W / 2} width={PAD_L} height={PAD_W} fill={padColor} rx={0.5} />
        <path
          d={`M ${ic.x + ic.w + PAD_L} ${py} L ${ic.x + ic.w + PAD_L + 1} ${py} L ${ic.x + ic.w + PAD_L + 3} ${py - GULL_DROP} L ${ic.x + ic.w + PAD_L + 7} ${py - GULL_DROP}`}
          stroke={pinColor} strokeWidth={LEAD_W} fill="none" strokeLinejoin="round"
        />
      </g>,
    );
  }
  return els;
}

/** Bottom gull-wing pins (connect down to handle) */
function bottomGullPins(
  x: number, y: number, w: number, count: number,
  padColor: string, pinColor: string,
): React.JSX.Element[] {
  const els: React.JSX.Element[] = [];
  const margin = 12;
  const spacing = (w - margin * 2) / Math.max(count - 1, 1);
  for (let i = 0; i < count; i++) {
    const px = x + margin + i * spacing;
    els.push(
      <g key={`bp${i}`}>
        <rect x={px - PAD_W / 2} y={y} width={PAD_W} height={PAD_L} fill={padColor} rx={0.5} />
        <path
          d={`M ${px} ${y + PAD_L} L ${px} ${y + PAD_L + 2} L ${px + GULL_DROP * 0.5} ${y + PAD_L + 5} L ${px + GULL_DROP * 0.5} ${y + PAD_L + 8}`}
          stroke={pinColor} strokeWidth={LEAD_W} fill="none" strokeLinejoin="round"
        />
      </g>,
    );
  }
  return els;
}

/** Top pins (shorter, decorative) */
function topPins(
  x: number, y: number, w: number, count: number,
  padColor: string, pinColor: string,
): React.JSX.Element[] {
  const els: React.JSX.Element[] = [];
  const margin = 12;
  const spacing = (w - margin * 2) / Math.max(count - 1, 1);
  for (let i = 0; i < count; i++) {
    const px = x + margin + i * spacing;
    els.push(
      <g key={`tp${i}`}>
        <rect x={px - PAD_W / 2} y={y - PAD_L} width={PAD_W} height={PAD_L} fill={padColor} rx={0.5} />
        <line x1={px} y1={y - PAD_L - 4} x2={px} y2={y - PAD_L}
          stroke={pinColor} strokeWidth={LEAD_W} />
      </g>,
    );
  }
  return els;
}

/* ---- Inner outlined LED with breathing glow ---- */
function InnerLed({ x, y, color, active, silkDim }: {
  x: number; y: number; color: string; active: boolean; silkDim: string;
}) {
  return (
    <g>
      {/* Outer breathing glow */}
      {active && (
        <circle cx={x} cy={y} r={8}
          fill={color} opacity={0.12}
          style={{ animation: 'pcb-led-glow-breathe 3s ease-in-out infinite' }} />
      )}
      <circle cx={x} cy={y} r={5}
        fill="none" stroke={color} strokeWidth={0.7} opacity={active ? 0.7 : 0.25} />
      <circle cx={x} cy={y} r={2.5}
        fill={color} opacity={active ? 0.85 : 0.2}
        style={active ? { animation: 'pcb-led-pulse 2s ease-in-out infinite' } : undefined} />
      <text x={x - 8} y={y + 0.5} textAnchor="end" dominantBaseline="central"
        fill={silkDim} fontSize={3.5} fontFamily="'IBM Plex Mono', monospace"
        opacity={0.5}>STS</text>
    </g>
  );
}

/* ---- Inner outlined alert triangle ---- */
function InnerAlert({ x, y }: { x: number; y: number }) {
  const size = 10;
  return (
    <g style={{ animation: 'pcb-alert-blink 1.2s ease-in-out infinite' }}>
      <polygon
        points={`${x},${y - size / 2} ${x - size / 2},${y + size / 2} ${x + size / 2},${y + size / 2}`}
        fill="none" stroke="#E1583E" strokeWidth={0.9} />
      <line x1={x} y1={y - 2.5} x2={x} y2={y + 1.5}
        stroke="#E1583E" strokeWidth={0.9} strokeLinecap="round" />
      <circle cx={x} cy={y + 3.5} r={0.6} fill="#E1583E" />
      <text x={x} y={y + size / 2 + 6} textAnchor="middle" dominantBaseline="central"
        fill="#E1583E" fontSize={4} fontFamily="'IBM Plex Mono', monospace"
        fontWeight={700} letterSpacing={0.8} opacity={0.8}>
        EXPOSED
      </text>
    </g>
  );
}

/* ---- Metric gauge helpers ---- */

/** Color for a percentage gauge: green → amber → red */
function gaugeColor(pct: number): string {
  if (pct < 50) return pcb.component.ledGreen;
  if (pct < 80) return pcb.component.ledAmber;
  return pcb.component.ledRed;
}

/** Format bytes/s to human-readable */
function formatRate(bytesPerSec: number): string {
  if (bytesPerSec < 1024) return `${Math.round(bytesPerSec)}B`;
  if (bytesPerSec < 1024 * 1024) return `${(bytesPerSec / 1024).toFixed(1)}K`;
  return `${(bytesPerSec / (1024 * 1024)).toFixed(1)}M`;
}

/* ================================================================
   CPU — large BGA square with heat sink fins, 6×8 grid, die outline
   + horizontal bar gauge inside die outline
   ================================================================ */
function renderCpu(ctx: RenderCtx): React.JSX.Element {
  const { w, h, chipBody, chipBorder, padColor, pinColor, silkDim, metrics } = ctx;
  const bx = 14, by = 10, bw = w - 28, bh = h - 30;

  // BGA pin grid on all 4 sides (10 per side)
  const bgaPins: React.JSX.Element[] = [];
  const bgaCount = 10;
  for (let side = 0; side < 4; side++) {
    for (let i = 0; i < bgaCount; i++) {
      let px: number, py: number;
      if (side === 0) { px = bx + 6 + i * ((bw - 12) / (bgaCount - 1)); py = by - 4; }
      else if (side === 1) { px = bx + 6 + i * ((bw - 12) / (bgaCount - 1)); py = by + bh + 1; }
      else if (side === 2) { px = bx - 4; py = by + 6 + i * ((bh - 12) / (bgaCount - 1)); }
      else { px = bx + bw + 1; py = by + 6 + i * ((bh - 12) / (bgaCount - 1)); }
      bgaPins.push(
        <rect key={`bga-${side}-${i}`} x={px} y={py} width={3} height={3}
          fill={padColor} rx={0.4} opacity={0.7} />,
      );
    }
  }

  // Interior BGA dot array (6×8)
  const dots: React.JSX.Element[] = [];
  for (let row = 0; row < 6; row++) {
    for (let col = 0; col < 8; col++) {
      dots.push(
        <circle key={`d-${row}-${col}`}
          cx={bx + 10 + col * ((bw - 20) / 7)}
          cy={by + 10 + row * ((bh - 20) / 5)}
          r={1} fill={silkDim} opacity={0.2} />,
      );
    }
  }

  // Heat sink fins on top surface
  const finCount = 8;
  const fins: React.JSX.Element[] = [];
  for (let i = 0; i < finCount; i++) {
    const ly = by + 6 + i * ((bh - 12) / (finCount - 1));
    fins.push(
      <line key={`fin-${i}`} x1={bx + 4} y1={ly} x2={bx + bw - 4} y2={ly}
        stroke={silkDim} strokeWidth={0.4} opacity={0.12} />,
    );
  }

  // Die outline + thermal pad
  const dieW = bw * 0.4, dieH = bh * 0.4;
  const dieCx = bx + bw / 2, dieCy = by + bh / 2;

  // CPU gauge bar inside die outline
  const gaugeW = dieW - 8;
  const gaugeH = 5;
  const gaugeX = dieCx - gaugeW / 2;
  const gaugeY = dieCy + dieH * 0.1;
  const fillW = gaugeW * (metrics.cpuPercent / 100);
  const gColor = gaugeColor(metrics.cpuPercent);

  return (
    <g>
      <rect x={bx} y={by} width={bw} height={bh}
        fill={chipBody} stroke={chipBorder} strokeWidth={0.6} rx={2} />
      <rect x={bx} y={by} width={bw} height={bh}
        fill="url(#pcb-chip-gradient)" rx={2} opacity={0.4} />
      {bgaPins}
      {dots}
      {fins}
      {/* Die outline */}
      <rect x={dieCx - dieW / 2} y={dieCy - dieH / 2} width={dieW} height={dieH}
        fill="none" stroke={silkDim} strokeWidth={0.5} opacity={0.25} rx={1} />
      {/* Thermal pad center */}
      <rect x={dieCx - dieW * 0.3} y={dieCy - dieH * 0.3} width={dieW * 0.6} height={dieH * 0.6}
        fill={silkDim} opacity={0.06} rx={0.5} />
      {/* CPU gauge bar */}
      <rect x={gaugeX} y={gaugeY} width={gaugeW} height={gaugeH}
        fill={silkDim} opacity={0.08} rx={1} />
      <rect x={gaugeX} y={gaugeY} width={fillW} height={gaugeH}
        fill={gColor} opacity={0.6} rx={1} />
      <text x={dieCx} y={gaugeY - 3} textAnchor="middle" dominantBaseline="auto"
        fill={gColor} fontSize={4} fontFamily="'IBM Plex Mono', monospace"
        fontWeight={700} opacity={0.8}>
        {Math.round(metrics.cpuPercent)}%
      </text>
      {/* Pin-1 dot */}
      <circle cx={bx + 6} cy={by + 6} r={2} fill={silkDim} opacity={0.5} />
      {/* Bottom pins connecting to handle */}
      {bottomGullPins(bx, by + bh, bw, 6, padColor, pinColor)}
      {/* Top decorative pins */}
      {topPins(bx, by, bw, 6, padColor, pinColor)}
    </g>
  );
}

/* ================================================================
   NETWORK — NIC with RJ45, transformer coils, edge connector
   + ↑↓ throughput indicators
   ================================================================ */
function renderNetwork(ctx: RenderCtx): React.JSX.Element {
  const { w, h, chipBody, chipBorder, padColor, pinColor, silkDim, isDark, metrics } = ctx;
  const bx = 8, by = 8, bw = w - 16, bh = h - 26;
  const notchW = 18, notchH = 14;

  // Edge connector pins along bottom
  const edgePins: React.JSX.Element[] = [];
  for (let i = 0; i < 12; i++) {
    edgePins.push(
      <rect key={`ep-${i}`} x={bx + 8 + i * ((bw - 16) / 11)} y={by + bh}
        width={2.5} height={5} fill={padColor} rx={0.3} opacity={0.6} />,
    );
  }

  const coilCx = bx + 18;
  const coilCy = by + bh / 2;

  // Throughput indicators position
  const indX = bx + bw * 0.42;
  const indY = by + bh * 0.35;

  return (
    <g>
      {/* Main body with RJ45 notch */}
      <path
        d={`M ${bx + 2} ${by}
            H ${bx + bw - notchW - 2}
            V ${by + (bh - notchH) / 2}
            H ${bx + bw - 2}
            V ${by + (bh + notchH) / 2}
            H ${bx + bw - notchW - 2}
            V ${by + bh}
            H ${bx + 2}
            Z`}
        fill={chipBody} stroke={chipBorder} strokeWidth={0.6}
      />
      <rect x={bx} y={by} width={bw} height={bh}
        fill="url(#pcb-chip-gradient)" rx={2} opacity={0.2} />

      {/* RJ45 port inner with latch */}
      <rect x={bx + bw - notchW + 2} y={by + (bh - notchH) / 2 + 2}
        width={notchW - 6} height={notchH - 4}
        fill={isDark ? '#0A0A0C' : '#D0D0CC'} stroke={chipBorder} strokeWidth={0.4} rx={1} />
      <rect x={bx + bw - notchW + 3} y={by + (bh - notchH) / 2 - 1.5}
        width={notchW - 8} height={2}
        fill={padColor} opacity={0.4} rx={0.3} />
      {/* Port contact pins inside */}
      {Array.from({ length: 4 }, (_, i) => (
        <line key={`rjp-${i}`}
          x1={bx + bw - notchW + 5 + i * 3} y1={by + (bh - notchH) / 2 + 4}
          x2={bx + bw - notchW + 5 + i * 3} y2={by + (bh + notchH) / 2 - 4}
          stroke={padColor} strokeWidth={0.4} opacity={0.3} />
      ))}

      {/* Status LEDs inside port */}
      <circle cx={bx + bw - 6} cy={by + (bh - notchH) / 2 + 4} r={1.5}
        fill={pcb.component.ledGreen} opacity={0.7} />
      <circle cx={bx + bw - 6} cy={by + (bh + notchH) / 2 - 4} r={1.5}
        fill={pcb.component.ledAmber} opacity={0.6}
        style={{ animation: 'pcb-led-blink 0.8s ease-in-out infinite' }} />

      {/* Transformer coils */}
      <g opacity={0.25} stroke={silkDim} fill="none" strokeWidth={0.6}>
        <path d={`M ${coilCx - 5} ${coilCy - 7} Q ${coilCx - 2} ${coilCy - 7} ${coilCx - 2} ${coilCy - 4}
          Q ${coilCx - 2} ${coilCy - 1} ${coilCx - 5} ${coilCy - 1}
          Q ${coilCx - 2} ${coilCy - 1} ${coilCx - 2} ${coilCy + 2}
          Q ${coilCx - 2} ${coilCy + 5} ${coilCx - 5} ${coilCy + 5}
          Q ${coilCx - 2} ${coilCy + 5} ${coilCx - 2} ${coilCy + 7}`} />
        <line x1={coilCx} y1={coilCy - 8} x2={coilCx} y2={coilCy + 8} />
        <path d={`M ${coilCx + 5} ${coilCy - 7} Q ${coilCx + 2} ${coilCy - 7} ${coilCx + 2} ${coilCy - 4}
          Q ${coilCx + 2} ${coilCy - 1} ${coilCx + 5} ${coilCy - 1}
          Q ${coilCx + 2} ${coilCy - 1} ${coilCx + 2} ${coilCy + 2}
          Q ${coilCx + 2} ${coilCy + 5} ${coilCx + 5} ${coilCy + 5}
          Q ${coilCx + 2} ${coilCy + 5} ${coilCx + 2} ${coilCy + 7}`} />
      </g>

      {/* Throughput indicators */}
      <g opacity={0.7}>
        {/* Up arrow */}
        <polygon points={`${indX},${indY - 4} ${indX - 2.5},${indY} ${indX + 2.5},${indY}`}
          fill={pcb.component.ledGreen} opacity={0.7} />
        <text x={indX + 5} y={indY - 1.5} textAnchor="start" dominantBaseline="central"
          fill={pcb.component.ledGreen} fontSize={3.5} fontFamily="'IBM Plex Mono', monospace"
          fontWeight={700} opacity={0.8}>
          {formatRate(metrics.netUp)}
        </text>
        {/* Down arrow */}
        <polygon points={`${indX},${indY + 10} ${indX - 2.5},${indY + 6} ${indX + 2.5},${indY + 6}`}
          fill={pcb.component.ledAmber} opacity={0.7} />
        <text x={indX + 5} y={indY + 8.5} textAnchor="start" dominantBaseline="central"
          fill={pcb.component.ledAmber} fontSize={3.5} fontFamily="'IBM Plex Mono', monospace"
          fontWeight={700} opacity={0.8}>
          {formatRate(metrics.netDown)}
        </text>
      </g>

      {/* MAC address */}
      <text x={bx + 8} y={by + bh - 4} textAnchor="start" dominantBaseline="central"
        fill={silkDim} fontSize={3} fontFamily="'IBM Plex Mono', monospace"
        opacity={0.3}>00:1A:2B:3C:4D</text>

      {edgePins}
      {/* QFP pins on sides */}
      {qfpPins({ x: bx, y: by, w: bw, h: bh }, 6, padColor, pinColor)}
      <circle cx={bx + 6} cy={by + 6} r={2} fill={silkDim} opacity={0.5} />
    </g>
  );
}

/* ================================================================
   COMMAND — large QFP chip with die window, pin-1 marker, cursor
   + cursor blink speed tied to cmdRate
   ================================================================ */
function renderCommand(ctx: RenderCtx): React.JSX.Element {
  const { w, h, chipBody, chipBorder, padColor, pinColor, silkDim, metrics } = ctx;
  const bx = 14, by = 8, bw = w - 28, bh = h - 26;

  // Die exposure window
  const winX = bx + bw * 0.2, winY = by + bh * 0.15;
  const winW = bw * 0.6, winH = bh * 0.55;

  // Cursor blink speed: faster when cmdRate is higher (range 0.2s-1.2s)
  const cursorSpeed = Math.max(0.2, 1.2 - metrics.cmdRate * 0.07);

  return (
    <g>
      <rect x={bx} y={by} width={bw} height={bh}
        fill={chipBody} stroke={chipBorder} strokeWidth={0.6} rx={2} />
      <rect x={bx} y={by} width={bw} height={bh}
        fill="url(#pcb-chip-gradient)" rx={2} opacity={0.4} />
      {qfpPins({ x: bx, y: by, w: bw, h: bh }, 7, padColor, pinColor)}
      {bottomGullPins(bx, by + bh, bw, 5, padColor, pinColor)}
      {topPins(bx, by, bw, 5, padColor, pinColor)}

      {/* Die exposure window */}
      <rect x={winX} y={winY} width={winW} height={winH}
        fill="none" stroke={silkDim} strokeWidth={0.5} opacity={0.25} rx={1} />

      {/* Terminal prompt lines inside window */}
      <g opacity={0.18}>
        <text x={winX + 4} y={winY + winH * 0.25} dominantBaseline="central"
          fill={silkDim} fontSize={3.5} fontFamily="'IBM Plex Mono', monospace">$ _</text>
        <line x1={winX + 4} y1={winY + winH * 0.45} x2={winX + winW * 0.7} y2={winY + winH * 0.45}
          stroke={silkDim} strokeWidth={0.5} />
        <line x1={winX + 4} y1={winY + winH * 0.6} x2={winX + winW * 0.5} y2={winY + winH * 0.6}
          stroke={silkDim} strokeWidth={0.5} />
        <line x1={winX + 4} y1={winY + winH * 0.75} x2={winX + winW * 0.65} y2={winY + winH * 0.75}
          stroke={silkDim} strokeWidth={0.5} />
      </g>

      {/* Blinking cursor tied to cmdRate */}
      <rect x={winX + 14} y={winY + winH * 0.2} width={2} height={5}
        fill={pcb.component.ledGreen} opacity={0.7}
        style={{ animation: `pcb-led-blink ${cursorSpeed}s ease-in-out infinite` }} />

      {/* cmd/s label */}
      <text x={winX + winW - 3} y={winY + winH - 4} textAnchor="end" dominantBaseline="auto"
        fill={silkDim} fontSize={3.5} fontFamily="'IBM Plex Mono', monospace"
        opacity={0.5}>{metrics.cmdRate.toFixed(1)}/s</text>

      {/* Pin-1 triangle */}
      <polygon points={`${bx + 4},${by + 4} ${bx + 9},${by + 4} ${bx + 4},${by + 9}`}
        fill={silkDim} opacity={0.4} />
    </g>
  );
}

/* ================================================================
   FILESYSTEM — drive module with platter, actuator, SATA-L
   + arc gauge around platter
   ================================================================ */
function renderFilesystem(ctx: RenderCtx): React.JSX.Element {
  const { w, h, chipBody, chipBorder, padColor, pinColor, silkDim, metrics } = ctx;
  const bx = 8, by = 8, bw = w - 16, bh = h - 26;

  // Mounting holes
  const holes = [
    { x: bx + 6, y: by + 6 }, { x: bx + bw - 6, y: by + 6 },
    { x: bx + 6, y: by + bh - 6 }, { x: bx + bw - 6, y: by + bh - 6 },
  ].map((p, i) => (
    <g key={`mh-${i}`}>
      <circle cx={p.x} cy={p.y} r={2.5} fill="none" stroke={silkDim} strokeWidth={0.5} opacity={0.35} />
      <circle cx={p.x} cy={p.y} r={1} fill={silkDim} opacity={0.15} />
    </g>
  ));

  // SATA L-shaped connector (data + power sections)
  const sataData: React.JSX.Element[] = [];
  for (let i = 0; i < 8; i++) {
    sataData.push(
      <rect key={`sd-${i}`} x={bx + 10 + i * ((bw * 0.45) / 7)}
        y={by + bh} width={3.5} height={5}
        fill={padColor} rx={0.4} opacity={0.65} />,
    );
  }
  const sataPower: React.JSX.Element[] = [];
  for (let i = 0; i < 5; i++) {
    sataPower.push(
      <rect key={`sp-${i}`} x={bx + bw * 0.58 + i * ((bw * 0.32) / 4)}
        y={by + bh} width={3.5} height={5}
        fill={padColor} rx={0.4} opacity={0.5} />,
    );
  }

  // Platter + actuator arm
  const platCx = bx + bw * 0.38, platCy = by + bh * 0.48;
  const platR = Math.min(bw, bh) * 0.3;

  // Arc gauge: fill proportional to disk%
  const arcAngle = (metrics.diskPercent / 100) * 270; // max 270 degrees
  const startAngle = 135; // start at bottom-left
  const endAngle = startAngle + arcAngle;
  const startRad = (startAngle * Math.PI) / 180;
  const endRad = (endAngle * Math.PI) / 180;
  const arcR = platR + 3;
  const x1 = platCx + arcR * Math.cos(startRad);
  const y1 = platCy + arcR * Math.sin(startRad);
  const x2 = platCx + arcR * Math.cos(endRad);
  const y2 = platCy + arcR * Math.sin(endRad);
  const largeArc = arcAngle > 180 ? 1 : 0;
  const diskColor = gaugeColor(metrics.diskPercent);

  return (
    <g>
      <rect x={bx} y={by} width={bw} height={bh}
        fill={chipBody} stroke={chipBorder} strokeWidth={0.6} rx={2} />
      <rect x={bx} y={by} width={bw} height={bh}
        fill="url(#pcb-chip-gradient)" rx={2} opacity={0.3} />
      {holes}

      {/* Platter */}
      <circle cx={platCx} cy={platCy} r={platR}
        fill="none" stroke={silkDim} strokeWidth={0.5} opacity={0.2} />
      <circle cx={platCx} cy={platCy} r={platR * 0.65}
        fill="none" stroke={silkDim} strokeWidth={0.3} opacity={0.15} />
      <circle cx={platCx} cy={platCy} r={platR * 0.3}
        fill="none" stroke={silkDim} strokeWidth={0.3} opacity={0.12} />
      <circle cx={platCx} cy={platCy} r={platR * 0.1}
        fill={silkDim} opacity={0.15} />

      {/* Arc gauge around platter */}
      {arcAngle > 0 && (
        <path
          d={`M ${x1} ${y1} A ${arcR} ${arcR} 0 ${largeArc} 1 ${x2} ${y2}`}
          fill="none" stroke={diskColor} strokeWidth={2} opacity={0.6}
          strokeLinecap="round" />
      )}
      {/* Disk % text */}
      <text x={platCx} y={platCy + 1} textAnchor="middle" dominantBaseline="central"
        fill={diskColor} fontSize={4.5} fontFamily="'IBM Plex Mono', monospace"
        fontWeight={700} opacity={0.7}>
        {Math.round(metrics.diskPercent)}%
      </text>

      {/* Actuator arm */}
      <line x1={bx + bw * 0.78} y1={by + bh * 0.82}
        x2={platCx + platR * 0.2} y2={platCy - platR * 0.2}
        stroke={silkDim} strokeWidth={0.8} opacity={0.2} />
      <circle cx={bx + bw * 0.78} cy={by + bh * 0.82} r={2.5}
        fill="none" stroke={silkDim} strokeWidth={0.5} opacity={0.2} />
      {/* Read head */}
      <rect x={platCx + platR * 0.1} y={platCy - platR * 0.3}
        width={4} height={2} fill={silkDim} opacity={0.15} rx={0.5} />

      {sataData}
      {sataPower}
      {/* Side QFP pins */}
      {qfpPins({ x: bx, y: by, w: bw, h: bh }, 5, padColor, pinColor)}
    </g>
  );
}

/* ================================================================
   MEMORY — DIMM stick with chip-on-board modules, SPD, notch
   + modules glow proportionally to usage
   ================================================================ */
function renderMemory(ctx: RenderCtx): React.JSX.Element {
  const { w, h, chipBody, chipBorder, padColor, silkDim, metrics } = ctx;
  const bx = 4, by = 8, bw = w - 8, bh = h - 26;

  // Edge connector gold fingers
  const fingerCount = 24;
  const fingers: React.JSX.Element[] = [];
  for (let i = 0; i < fingerCount; i++) {
    const fx = bx + 6 + i * ((bw - 12) / (fingerCount - 1));
    fingers.push(
      <rect key={`f-${i}`} x={fx - 1.2} y={by + bh} width={2.4} height={6}
        fill={padColor} rx={0.3} opacity={0.6} />,
    );
  }

  // Notch in bottom edge
  const notchX = bx + bw / 2;

  // How many modules "lit" based on memPercent
  const moduleCount = 8;
  const litModules = Math.ceil((metrics.memPercent / 100) * moduleCount);
  const memColor = gaugeColor(metrics.memPercent);

  return (
    <g>
      {/* DIMM body with notch */}
      <path
        d={`M ${bx + 2} ${by}
            H ${bx + bw - 2}
            V ${by + bh}
            H ${notchX + 5}
            V ${by + bh + 4}
            H ${notchX - 5}
            V ${by + bh}
            H ${bx + 2}
            Z`}
        fill={chipBody} stroke={chipBorder} strokeWidth={0.6}
      />
      <rect x={bx} y={by} width={bw} height={bh}
        fill="url(#pcb-chip-gradient)" rx={1} opacity={0.3} />

      {/* Chip-on-board modules (8 modules) — lit proportionally */}
      {Array.from({ length: moduleCount }, (_, i) => {
        const chipW = (bw - 16) / 8 - 2;
        const cx = bx + 8 + i * ((bw - 16) / 8);
        const isLit = i < litModules;
        return (
          <g key={`mc-${i}`}>
            <rect x={cx} y={by + 3} width={chipW} height={bh - 6}
              fill={isLit ? memColor : silkDim} opacity={isLit ? 0.18 : 0.07} rx={0.8} />
            <rect x={cx + 0.5} y={by + 3.5} width={chipW - 1} height={bh - 7}
              fill="none" stroke={isLit ? memColor : silkDim} strokeWidth={0.3}
              opacity={isLit ? 0.4 : 0.15} rx={0.5} />
            <circle cx={cx + 2} cy={by + 5} r={0.5} fill={silkDim} opacity={0.25} />
          </g>
        );
      })}

      {/* Memory % label */}
      <text x={bx + bw - 6} y={by + bh - 3} textAnchor="end" dominantBaseline="auto"
        fill={memColor} fontSize={4} fontFamily="'IBM Plex Mono', monospace"
        fontWeight={700} opacity={0.7}>
        {Math.round(metrics.memPercent)}%
      </text>

      {/* SPD chip */}
      <rect x={bx + bw * 0.42} y={by + 2} width={8} height={5}
        fill={silkDim} opacity={0.06} rx={0.5} />
      <text x={bx + bw * 0.42 + 4} y={by + 4.5} textAnchor="middle" dominantBaseline="central"
        fill={silkDim} fontSize={2.5} fontFamily="'IBM Plex Mono', monospace" opacity={0.2}>SPD</text>

      {/* Latch clips at edges */}
      <rect x={bx - 1} y={by + bh * 0.2} width={3} height={8}
        fill="none" stroke={silkDim} strokeWidth={0.4} opacity={0.25} rx={0.5} />
      <rect x={bx + bw - 2} y={by + bh * 0.2} width={3} height={8}
        fill="none" stroke={silkDim} strokeWidth={0.4} opacity={0.25} rx={0.5} />

      {fingers}
    </g>
  );
}

/* ================================================================
   MONITORING — large QFP with bar chart + test probes
   + bar heights reflect actual CPU usage
   ================================================================ */
function renderMonitoring(ctx: RenderCtx): React.JSX.Element {
  const { w, h, chipBody, chipBorder, padColor, pinColor, silkDim, metrics } = ctx;
  const bx = 14, by = 8, bw = w - 28, bh = h - 26;

  // Bar chart — heights driven by metrics
  const barX = bx + bw * 0.2;
  const barBaseY = by + bh * 0.78;
  const barW = 4;
  const cpuPct = metrics.cpuPercent / 100;
  // Generate bar heights that vary around the CPU percentage
  const barHeights = [
    cpuPct * 0.6, cpuPct * 1.1, cpuPct * 0.8,
    cpuPct * 1.3, cpuPct * 0.9, cpuPct * 1.0,
  ].map((v) => Math.max(0.05, Math.min(1, v)));

  return (
    <g>
      <rect x={bx} y={by} width={bw} height={bh}
        fill={chipBody} stroke={chipBorder} strokeWidth={0.6} rx={2} />
      <rect x={bx} y={by} width={bw} height={bh}
        fill="url(#pcb-chip-gradient)" rx={2} opacity={0.4} />
      {qfpPins({ x: bx, y: by, w: bw, h: bh }, 6, padColor, pinColor)}
      {bottomGullPins(bx, by + bh, bw, 4, padColor, pinColor)}
      {topPins(bx, by, bw, 4, padColor, pinColor)}

      {/* Bar chart — dynamic heights */}
      <g>
        {barHeights.map((height, i) => {
          const barColor = gaugeColor(height * 100);
          return (
            <rect key={`bar-${i}`}
              x={barX + i * (barW + 2.5)} y={barBaseY - bh * 0.5 * height}
              width={barW} height={bh * 0.5 * height}
              fill={barColor} opacity={0.5} rx={0.3} />
          );
        })}
        <line x1={barX - 2} y1={barBaseY} x2={barX + 6 * (barW + 2.5)} y2={barBaseY}
          stroke={silkDim} strokeWidth={0.5} opacity={0.3} />
        <line x1={barX - 2} y1={barBaseY} x2={barX - 2} y2={barBaseY - bh * 0.45}
          stroke={silkDim} strokeWidth={0.4} opacity={0.3} />
      </g>

      {/* Test probe points */}
      <g opacity={0.35}>
        <circle cx={bx + 5} cy={by + bh - 5} r={2.5}
          fill="none" stroke={padColor} strokeWidth={0.6} />
        <circle cx={bx + 5} cy={by + bh - 5} r={1} fill={padColor} />
        <text x={bx + 5} y={by + bh - 10} textAnchor="middle" dominantBaseline="central"
          fill={silkDim} fontSize={2.5} fontFamily="'IBM Plex Mono', monospace">TP1</text>
        <circle cx={bx + bw - 5} cy={by + bh - 5} r={2.5}
          fill="none" stroke={padColor} strokeWidth={0.6} />
        <circle cx={bx + bw - 5} cy={by + bh - 5} r={1} fill={padColor} />
        <text x={bx + bw - 5} y={by + bh - 10} textAnchor="middle" dominantBaseline="central"
          fill={silkDim} fontSize={2.5} fontFamily="'IBM Plex Mono', monospace">TP2</text>
      </g>

      <circle cx={bx + 6} cy={by + 6} r={2} fill={silkDim} opacity={0.5} />
    </g>
  );
}

/* ================================================================
   LOGS — large QFP with log lines, buffer capacitor, crystal
   + line opacity pulses with log activity rate
   ================================================================ */
function renderLogs(ctx: RenderCtx): React.JSX.Element {
  const { w, h, chipBody, chipBorder, padColor, pinColor, silkDim, metrics } = ctx;
  const bx = 14, by = 8, bw = w - 28, bh = h - 26;

  const lineWidths = [0.75, 0.5, 0.85, 0.6, 0.4, 0.7, 0.55];
  // Log line opacity driven by logRate (range 0.1 - 0.45)
  const lineOpacity = 0.1 + Math.min(metrics.logRate / 80, 1) * 0.35;
  // Pulse speed: faster when logRate is higher
  const pulseSpeed = Math.max(0.5, 2.5 - metrics.logRate * 0.025);

  return (
    <g>
      <rect x={bx} y={by} width={bw} height={bh}
        fill={chipBody} stroke={chipBorder} strokeWidth={0.6} rx={2} />
      <rect x={bx} y={by} width={bw} height={bh}
        fill="url(#pcb-chip-gradient)" rx={2} opacity={0.4} />
      {qfpPins({ x: bx, y: by, w: bw, h: bh }, 6, padColor, pinColor)}
      {bottomGullPins(bx, by + bh, bw, 4, padColor, pinColor)}
      {topPins(bx, by, bw, 4, padColor, pinColor)}

      {/* Log lines — opacity pulses with activity */}
      <g opacity={lineOpacity}
        style={{ animation: `pcb-led-pulse ${pulseSpeed}s ease-in-out infinite` }}>
        {lineWidths.map((wFrac, i) => (
          <line key={`ll-${i}`}
            x1={bx + 8} y1={by + 10 + i * ((bh - 20) / 6)}
            x2={bx + 8 + (bw - 16) * wFrac} y2={by + 10 + i * ((bh - 20) / 6)}
            stroke={silkDim} strokeWidth={0.9} strokeLinecap="round" />
        ))}
      </g>

      {/* Log rate label */}
      <text x={bx + bw - 5} y={by + bh - 4} textAnchor="end" dominantBaseline="auto"
        fill={silkDim} fontSize={3.5} fontFamily="'IBM Plex Mono', monospace"
        opacity={0.5}>{Math.round(metrics.logRate)}/s</text>

      {/* Buffer capacitor */}
      <g opacity={0.3}>
        <rect x={bx + bw - 10} y={by + bh - 8} width={6} height={4}
          fill="none" stroke={silkDim} strokeWidth={0.5} rx={0.4} />
        <text x={bx + bw - 7} y={by + bh - 6} textAnchor="middle" dominantBaseline="central"
          fill={silkDim} fontSize={2.5} fontFamily="'IBM Plex Mono', monospace">C1</text>
      </g>

      {/* Crystal oscillator */}
      <g opacity={0.2}>
        <rect x={bx + 4} y={by + bh - 10} width={4} height={7}
          fill="none" stroke={silkDim} strokeWidth={0.4} rx={1} />
        <text x={bx + 6} y={by + bh - 3} textAnchor="middle" dominantBaseline="central"
          fill={silkDim} fontSize={2} fontFamily="'IBM Plex Mono', monospace">Y1</text>
      </g>

      <circle cx={bx + 6} cy={by + 6} r={2} fill={silkDim} opacity={0.5} />
    </g>
  );
}

/* ---- Variant registry (larger sizes) ---- */
const VARIANTS: Record<SystemComponentType, VariantDef> = {
  cpu:        { w: 140, h: 120, render: renderCpu },
  network:    { w: 150, h: 90,  render: renderNetwork },
  command:    { w: 120, h: 90,  render: renderCommand },
  filesystem: { w: 150, h: 95,  render: renderFilesystem },
  memory:     { w: 165, h: 70,  render: renderMemory },
  monitoring: { w: 115, h: 90,  render: renderMonitoring },
  logs:       { w: 115, h: 90,  render: renderLogs },
};

/* ---- Ref designators ---- */
const REF_MAP: Record<SystemComponentType, string> = {
  cpu: 'U1', network: 'U2', command: 'U3', filesystem: 'U4',
  memory: 'U5', monitoring: 'U6', logs: 'U7',
};

export const SystemComponentNode = memo(({ data }: NodeProps) => {
  const {
    componentType, label, sublabel, exposed,
  } = data as unknown as SystemComponentData;

  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';
  const metrics = useSnapshot(systemMetricsStore) as SystemMetrics;

  const variant = VARIANTS[componentType];
  if (!variant) return null;

  const { w, h, render: renderBody } = variant;

  const chipBody   = isDark ? pcb.component.body : '#D8D8D0';
  const chipBorder = exposed
    ? '#E1583E'
    : (isDark ? 'rgba(80,80,80,0.3)' : 'rgba(80,80,80,0.2)');
  const padColor   = pcb.component.padGold;
  const pinColor   = pcb.component.pin;
  const traceClr   = isDark ? pcb.trace.silver : '#888888';
  const silkColor  = isDark ? pcb.silk.primary : pcb.light.silk;
  const silkDim    = isDark ? pcb.silk.dim : '#6A6A5A';
  const ledColor   = exposed ? pcb.component.ledRed : pcb.component.ledGreen;
  const ref = REF_MAP[componentType] ?? 'U?';

  // LED position (top-right inside body)
  const ledX = w - 18;
  const ledY = 14;

  // Alert position (bottom-right inside body)
  const alertX = w - 18;
  const alertY = h - 24;

  return (
    <div style={{ position: 'relative', cursor: 'default' }}>
      {/* Handles */}
      <Handle type="source" position={Position.Bottom} id="bottom"
        style={{ left: w / 2 - 3, visibility: 'hidden' }} />
      <Handle type="target" position={Position.Bottom} id="bottom-in"
        style={{ left: w / 2 + 3, visibility: 'hidden' }} />
      <Handle type="target" position={Position.Left} id="left"
        style={{ top: h / 2, visibility: 'hidden' }} />
      <Handle type="target" position={Position.Right} id="right"
        style={{ top: h / 2, left: w, visibility: 'hidden' }} />

      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`}
        style={{ display: 'block', overflow: 'visible' }}>

        {/* === Component body (variant-specific) === */}
        {renderBody({
          w, h, isDark, chipBody, chipBorder, padColor, pinColor,
          traceClr, silkColor, silkDim, exposed, metrics,
        })}

        {/* === Red outlined border when exposed === */}
        {exposed && (
          <rect x={1} y={1} width={w - 2} height={h - 2}
            fill="none" stroke="#E1583E" strokeWidth={1} rx={3}
            opacity={0.6}
            style={{ animation: 'danger-chip-pulse 2s ease-in-out infinite' }} />
        )}

        {/* === Label (top-left, prominent) === */}
        <text x={6} y={6} textAnchor="start" dominantBaseline="hanging"
          fill={silkColor} fontSize={8} fontFamily="'IBM Plex Mono', monospace"
          fontWeight={700} letterSpacing={1}>
          {label}
        </text>

        {/* === Sublabel (below label) === */}
        <text x={6} y={17} textAnchor="start" dominantBaseline="hanging"
          fill={silkDim} fontSize={4.5} fontFamily="'IBM Plex Mono', monospace"
          letterSpacing={0.3}>
          {sublabel}
        </text>

        {/* === Ref designator (bottom-left) === */}
        <text x={5} y={h - 5} textAnchor="start" dominantBaseline="auto"
          fill={silkDim} fontSize={4} fontFamily="'IBM Plex Mono', monospace"
          opacity={0.5}>{ref}</text>

        {/* === Inner outlined LED with breathing glow (top-right, inside body) === */}
        <InnerLed x={ledX} y={ledY} color={ledColor} active={true} silkDim={silkDim} />

        {/* === Inner outlined alert (bottom-right, inside body, when exposed) === */}
        {exposed && (
          <InnerAlert x={alertX} y={alertY} />
        )}
      </svg>
    </div>
  );
});
SystemComponentNode.displayName = 'SystemComponentNode';
