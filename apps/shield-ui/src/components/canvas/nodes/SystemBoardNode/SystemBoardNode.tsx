/**
 * SystemBoardNode — large system motherboard PCB (dynamic width x 200).
 *
 * Sub-chips:
 *   U1  CPU       (90x70)  — Cpu icon, 2 LEDs
 *   U2  NET CTRL  (75x55)  — Wifi icon, LINK LED
 *   U3  DISK CTRL (75x55)  — HardDrive icon, ACT LED
 *   U4  MEM CTRL  (75x55)  — MemoryStick icon, OK LED
 *   U5  SHIELD    (75x55)  — Shield icon, FW LED (conditional)
 *
 * Single bottom-center connector to backplane bus.
 * Trace routes connect each sub-chip to a horizontal bus, then to bottom connector.
 */

import { memo, useMemo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Cpu, Wifi, HardDrive, MemoryStick, Shield } from 'lucide-react';
import { useTheme } from '@mui/material/styles';
import { pcb } from '../../styles/pcb-tokens';
import type { SystemBoardData } from '../../Canvas.types';

/* ---- Dimensions ---- */
const DEFAULT_BOARD_W = 480;
const SHIELD_BOARD_W = 580;
const BOARD_H = 200;

/* ---- Pin / pad proportions ---- */
const PAD_W = 3;
const PAD_L = 3;
const LEAD_W = 0.8;
const LEAD_L = 4;

/* ---- Sub-chip definitions ---- */
interface ChipDef {
  id: string;
  label: string;
  sublabel: string;
  icon: typeof Cpu;
  w: number;
  h: number;
  ref: string;
  ledCount: number;
  ledLabel?: string;
}

const BASE_CHIPS: ChipDef[] = [
  { id: 'cpu',  label: 'CPU',       sublabel: '', icon: Cpu,         w: 90, h: 70, ref: 'U1', ledCount: 2 },
  { id: 'net',  label: 'NET CTRL',  sublabel: 'eth0',   icon: Wifi,        w: 75, h: 55, ref: 'U2', ledCount: 1, ledLabel: 'LINK' },
  { id: 'disk', label: 'DISK CTRL', sublabel: 'nvme0',  icon: HardDrive,   w: 75, h: 55, ref: 'U3', ledCount: 1, ledLabel: 'ACT' },
  { id: 'mem',  label: 'MEM CTRL',  sublabel: 'DDR5',   icon: MemoryStick, w: 75, h: 55, ref: 'U4', ledCount: 1, ledLabel: 'OK' },
];

const SHIELD_CHIP: ChipDef = {
  id: 'shield', label: 'SHIELD', sublabel: 'daemon', icon: Shield, w: 75, h: 55, ref: 'U5', ledCount: 1, ledLabel: 'FW',
};

const LED_COLOR_MAP: Record<string, string> = {
  secure: pcb.component.ledGreen,
  partial: pcb.component.ledAmber,
  unprotected: pcb.component.ledRed,
  critical: pcb.component.ledRed,
};

export const SystemBoardNode = memo(({ data }: NodeProps) => {
  const {
    currentUser, securityLevel, hasShieldDaemon, boardWidth,
  } = data as unknown as SystemBoardData;

  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';

  const chips = useMemo(
    () => hasShieldDaemon ? [...BASE_CHIPS, SHIELD_CHIP] : BASE_CHIPS,
    [hasShieldDaemon],
  );

  const boardW = boardWidth ?? (hasShieldDaemon ? SHIELD_BOARD_W : DEFAULT_BOARD_W);

  const bodyColor  = isDark ? pcb.board.solderMask : '#EDEDDF';
  const silkColor  = isDark ? pcb.silk.primary : pcb.light.silk;
  const silkDim    = isDark ? pcb.silk.dim : '#6A6A5A';
  const borderClr  = 'rgba(136,136,136,0.4)';
  const padColor   = pcb.component.padGold;
  const pinColor   = pcb.component.pin;
  const chipBody   = isDark ? pcb.component.body : '#D8D8D0';
  const chipBorder = isDark ? 'rgba(80,80,80,0.3)' : 'rgba(80,80,80,0.2)';
  const traceClr   = isDark ? pcb.trace.silver : '#888888';
  const ledColor   = LED_COLOR_MAP[securityLevel] ?? pcb.component.ledGreen;

  /* ---- Sub-chip positions ---- */
  const chipY = 28;
  const chipGap = 14;
  const totalChipW = chips.reduce((a, c) => a + c.w, 0) + chipGap * (chips.length - 1);
  const chipStartX = (boardW - totalChipW) / 2;

  const chipXPositions: number[] = [];
  {
    let cx = chipStartX;
    for (const chip of chips) {
      chipXPositions.push(cx);
      cx += chip.w + chipGap;
    }
  }

  /* ---- Horizontal bus Y (below chips) ---- */
  const busY = chipY + 80;
  const busY2 = busY + 8;

  /* ---- Decorative elements ---- */
  const fingerCount = 16;
  const fingerPitch = (boardW - 16) / fingerCount;

  const caps = [
    { x: boardW - 42, y: 48, ref: 'C1' },
    { x: boardW - 42, y: 58, ref: 'C2' },
    { x: boardW - 30, y: 48, ref: 'C3' },
    { x: boardW - 30, y: 58, ref: 'C4' },
    { x: chipXPositions[0] - 14, y: 60, ref: 'C5' },
    { x: chipXPositions[0] - 14, y: 72, ref: 'C6' },
  ];

  const vias = [
    { x: 18, y: busY + 4 },
    { x: boardW - 18, y: busY + 4 },
    { x: chipStartX - 10, y: chipY + 35 },
    { x: chipStartX + totalChipW + 10, y: chipY + 35 },
    { x: boardW / 2, y: busY + 20 },
    { x: boardW / 2 - 30, y: BOARD_H - 20 },
    { x: boardW / 2 + 30, y: BOARD_H - 20 },
  ];

  /* ---- CLK position ---- */
  const clkX = boardW - 52;
  const clkY = 22;

  /* ---- Bottom connector (center) ---- */
  const connX = boardW / 2;

  return (
    <div style={{ position: 'relative', cursor: 'default' }}>
      {/* Handles */}
      <Handle type="target" position={Position.Top} id="top" style={{ visibility: 'hidden' }} />
      <Handle type="source" position={Position.Right} id="right" style={{ visibility: 'hidden' }} />
      <Handle type="source" position={Position.Left} id="left" style={{ visibility: 'hidden' }} />

      {/* Single bottom-center handle to backplane bus */}
      <Handle
        type="source"
        position={Position.Bottom}
        id="bottom-center"
        style={{ left: boardW / 2, visibility: 'hidden' }}
      />

      <svg width={boardW} height={BOARD_H} viewBox={`0 0 ${boardW} ${BOARD_H}`}
        style={{ display: 'block', overflow: 'visible' }}>

        {/* === Board body === */}
        <rect x={0} y={0} width={boardW} height={BOARD_H}
          fill={bodyColor} stroke={borderClr} strokeWidth={1.5} rx={3} />
        <rect x={0} y={0} width={boardW} height={BOARD_H}
          fill="url(#pcb-chip-gradient)" rx={3} opacity={0.3} />

        {/* === Decorative gold fingers (top) === */}
        {Array.from({ length: fingerCount }, (_, i) => (
          <rect key={`f-${i}`} x={8 + i * fingerPitch}
            y={0} width={fingerPitch * 0.6} height={5}
            fill={padColor} rx={0.8} opacity={0.5} />
        ))}

        {/* Pin-1 marker */}
        <circle cx={10} cy={18} r={2.5} fill={silkDim} opacity={0.55} />

        {/* === CLK oscillator (Y1) === */}
        <rect x={clkX} y={clkY} width={22} height={12}
          fill={chipBody} stroke={chipBorder} strokeWidth={0.5} rx={2} />
        <rect x={clkX - 2} y={clkY + 2} width={2.5} height={3} fill={padColor} rx={0.3} />
        <rect x={clkX - 2} y={clkY + 7} width={2.5} height={3} fill={padColor} rx={0.3} />
        <rect x={clkX + 21.5} y={clkY + 2} width={2.5} height={3} fill={padColor} rx={0.3} />
        <rect x={clkX + 21.5} y={clkY + 7} width={2.5} height={3} fill={padColor} rx={0.3} />
        <text x={clkX + 11} y={clkY + 7} textAnchor="middle" dominantBaseline="central"
          fill={silkDim} fontSize={4.5} fontFamily="'IBM Plex Mono', monospace">CLK</text>
        <text x={clkX + 24} y={clkY - 1} fill={silkDim} fontSize={3.5}
          fontFamily="'IBM Plex Mono', monospace" opacity={0.5}>Y1</text>

        {/* ================================================================
            HORIZONTAL BUS TRACES — connecting chip region to bottom connector
            ================================================================ */}
        <g opacity={0.2} stroke={traceClr} fill="none">
          <line x1={20} y1={busY} x2={boardW - 20} y2={busY} strokeWidth={1} />
          <line x1={30} y1={busY2} x2={boardW - 30} y2={busY2} strokeWidth={0.8} />
        </g>

        {/* === Sub-chips === */}
        {chips.map((chip, ci) => {
          const cx = chipXPositions[ci];
          const iconSize = chip.id === 'cpu' ? 22 : 18;
          const Icon = chip.icon;
          const sidePins = chip.id === 'cpu' ? 8 : 5;
          const pinSpacing = (chip.h - 10) / (sidePins + 1);
          const chipSublabel = chip.id === 'cpu' ? currentUser : chip.sublabel;

          return (
            <g key={chip.id}>
              {/* Chip body */}
              <rect x={cx} y={chipY} width={chip.w} height={chip.h}
                fill={chipBody} stroke={chipBorder} strokeWidth={0.5} rx={2} />
              <rect x={cx} y={chipY} width={chip.w} height={chip.h}
                fill="url(#pcb-chip-gradient)" rx={2} opacity={0.4} />

              {/* Left pins */}
              {Array.from({ length: sidePins }, (_, i) => {
                const py = chipY + 5 + (i + 1) * pinSpacing;
                return (
                  <g key={`lp-${i}`}>
                    <rect x={cx - PAD_L} y={py - PAD_W / 2} width={PAD_L} height={PAD_W}
                      fill={padColor} rx={0.4} />
                    <line x1={cx - PAD_L - LEAD_L} y1={py} x2={cx - PAD_L} y2={py}
                      stroke={pinColor} strokeWidth={LEAD_W} />
                  </g>
                );
              })}

              {/* Right pins */}
              {Array.from({ length: sidePins }, (_, i) => {
                const py = chipY + 5 + (i + 1) * pinSpacing;
                return (
                  <g key={`rp-${i}`}>
                    <rect x={cx + chip.w} y={py - PAD_W / 2} width={PAD_L} height={PAD_W}
                      fill={padColor} rx={0.4} />
                    <line x1={cx + chip.w + PAD_L} y1={py} x2={cx + chip.w + PAD_L + LEAD_L} y2={py}
                      stroke={pinColor} strokeWidth={LEAD_W} />
                  </g>
                );
              })}

              {/* Bottom pins (4) — connect to bus traces */}
              {Array.from({ length: 4 }, (_, i) => {
                const px = cx + 12 + i * ((chip.w - 24) / 3);
                return (
                  <g key={`bp-${i}`}>
                    <rect x={px - PAD_W / 2} y={chipY + chip.h} width={PAD_W} height={PAD_L}
                      fill={padColor} rx={0.4} />
                    <line x1={px} y1={chipY + chip.h + PAD_L} x2={px} y2={chipY + chip.h + PAD_L + LEAD_L}
                      stroke={pinColor} strokeWidth={LEAD_W} />
                  </g>
                );
              })}

              {/* Chip -> bus traces (vertical stubs from bottom pins to bus) */}
              <g opacity={0.2} stroke={traceClr} fill="none" strokeWidth={0.6}>
                {Array.from({ length: 4 }, (_, i) => {
                  const px = cx + 12 + i * ((chip.w - 24) / 3);
                  return <line key={`ct-${i}`} x1={px} y1={chipY + chip.h + PAD_L + LEAD_L} x2={px} y2={busY} />;
                })}
              </g>

              {/* Pin-1 dot */}
              <circle cx={cx + 5} cy={chipY + 5} r={1.5} fill={silkDim} opacity={0.5} />

              {/* Icon */}
              <foreignObject x={cx + 5} y={chipY + 8} width={iconSize + 4} height={iconSize + 4}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
                  <Icon size={iconSize} color={chip.id === 'shield' ? pcb.component.ledGreen : pcb.trace.bright} />
                </div>
              </foreignObject>

              {/* Label */}
              <text x={cx + (chip.id === 'cpu' ? 34 : 28)} y={chipY + 16}
                dominantBaseline="central" fill={silkColor}
                fontSize={chip.id === 'cpu' ? 9 : 7} fontFamily="'IBM Plex Mono', monospace"
                fontWeight={700} letterSpacing={0.8}>
                {chip.label}
              </text>

              {/* Sublabel */}
              {chipSublabel && (
                <text x={cx + (chip.id === 'cpu' ? 34 : 28)} y={chipY + 28}
                  dominantBaseline="central" fill={silkDim} fontSize={6}
                  fontFamily="'IBM Plex Mono', monospace" letterSpacing={0.4}>
                  {chipSublabel}
                </text>
              )}

              {/* Ref designator */}
              <text x={cx + chip.w - 3} y={chipY - 2} textAnchor="end"
                fill={silkDim} fontSize={4} fontFamily="'IBM Plex Mono', monospace"
                opacity={0.5}>{chip.ref}</text>

              {/* SMD LEDs */}
              {Array.from({ length: chip.ledCount }, (_, li) => {
                const lx = cx + 6 + li * 16;
                const ly = chipY + chip.h - 14;
                return (
                  <g key={`led-${li}`}>
                    <circle cx={lx + 2.5} cy={ly + 1.5} r={6} fill={ledColor} opacity={0.25}
                      style={{ animation: 'pcb-led-glow-breathe 2s ease-in-out infinite' }} />
                    <rect x={lx - 2} y={ly} width={2} height={3} fill={padColor} rx={0.3} />
                    <rect x={lx + 5} y={ly} width={2} height={3} fill={padColor} rx={0.3} />
                    <rect x={lx} y={ly} width={5} height={3}
                      fill={isDark ? pcb.component.bodyLight : '#e0e0d8'} stroke={chipBorder} strokeWidth={0.3} rx={0.5} />
                    <rect x={lx + 1} y={ly + 0.5} width={3} height={2}
                      fill={ledColor} rx={0.5} opacity={0.85}
                      style={{ animation: 'pcb-led-pulse 2s ease-in-out infinite' }} />
                    <circle cx={lx + 2.5} cy={ly + 1.5} r={0.7} fill="white" opacity={0.5} />
                    <line x1={lx - 2} y1={ly + 1.5} x2={cx} y2={ly + 1.5}
                      stroke={traceClr} strokeWidth={0.4} opacity={0.15} />
                  </g>
                );
              })}

              {/* LED label */}
              {chip.ledLabel && (
                <text x={cx + 6} y={chipY + chip.h - 3} dominantBaseline="central"
                  fill={silkDim} fontSize={4} fontFamily="'IBM Plex Mono', monospace"
                  letterSpacing={0.3}>{chip.ledLabel}</text>
              )}
            </g>
          );
        })}

        {/* === Inter-chip traces (CPU -> controllers) === */}
        <g opacity={0.18} stroke={traceClr} fill="none" strokeWidth={0.6}>
          {/* CPU right -> NET left */}
          <line x1={chipXPositions[0] + chips[0].w + PAD_L + LEAD_L}
                y1={chipY + 25}
                x2={chipXPositions[1] - PAD_L - LEAD_L}
                y2={chipY + 25} />
          <line x1={chipXPositions[0] + chips[0].w + PAD_L + LEAD_L}
                y1={chipY + 40}
                x2={chipXPositions[1] - PAD_L - LEAD_L}
                y2={chipY + 40} />
          {/* NET right -> DISK left */}
          <line x1={chipXPositions[1] + chips[1].w + PAD_L + LEAD_L}
                y1={chipY + 25}
                x2={chipXPositions[2] - PAD_L - LEAD_L}
                y2={chipY + 25} />
          {/* DISK right -> MEM left */}
          <line x1={chipXPositions[2] + chips[2].w + PAD_L + LEAD_L}
                y1={chipY + 25}
                x2={chipXPositions[3] - PAD_L - LEAD_L}
                y2={chipY + 25} />
          {/* MEM right -> SHIELD left (if present) */}
          {chips.length > 4 && (
            <line x1={chipXPositions[3] + chips[3].w + PAD_L + LEAD_L}
                  y1={chipY + 25}
                  x2={chipXPositions[4] - PAD_L - LEAD_L}
                  y2={chipY + 25} />
          )}
        </g>

        {/* CLK trace to CPU */}
        <g opacity={0.15} stroke={traceClr} fill="none" strokeWidth={0.5}>
          <path d={`M ${clkX} ${clkY + 6} H ${chipXPositions[0] + chips[0].w + PAD_L + LEAD_L + 8} V ${chipY + 15}`} />
        </g>

        {/* === Bus to bottom connector vertical traces === */}
        <g opacity={0.18} stroke={traceClr} fill="none" strokeWidth={0.6}>
          {Array.from({ length: 4 }, (_, i) => {
            const px = connX - 6 + i * 4;
            return <line key={`bv-${i}`} x1={px} y1={busY2} x2={px} y2={BOARD_H - 16} />;
          })}
        </g>

        {/* === Capacitors === */}
        {caps.map((c) => (
          <g key={c.ref}>
            <rect x={c.x} y={c.y} width={6} height={3}
              fill={chipBody} stroke={chipBorder} strokeWidth={0.3} rx={0.5} />
            <rect x={c.x - 1.5} y={c.y + 0.5} width={1.5} height={2} fill={padColor} rx={0.3} />
            <rect x={c.x + 6} y={c.y + 0.5} width={1.5} height={2} fill={padColor} rx={0.3} />
            <text x={c.x + 3} y={c.y - 2} textAnchor="middle" fill={silkDim} fontSize={3}
              fontFamily="'IBM Plex Mono', monospace" opacity={0.4}>{c.ref}</text>
            <line x1={c.x + 3} y1={c.y + 3} x2={c.x + 3} y2={c.y + 10}
              stroke={padColor} strokeWidth={0.4} opacity={0.15} />
          </g>
        ))}

        {/* === Via pads === */}
        {vias.map((v, i) => (
          <g key={`v-${i}`}>
            <circle cx={v.x} cy={v.y} r={2.5} fill="none"
              stroke={pcb.via.ring} strokeWidth={0.8} opacity={0.45} />
            <circle cx={v.x} cy={v.y} r={1} fill={pcb.via.fill} opacity={0.45} />
          </g>
        ))}

        {/* === Bottom silkscreen === */}
        <text x={14} y={busY + 18} dominantBaseline="central"
          fill={silkDim} fontSize={6} fontFamily="'IBM Plex Mono', monospace"
          letterSpacing={0.5} opacity={0.6}>
          SYSTEM BOARD  REV:1.0  {currentUser}@localhost
        </text>

        {/* === Bottom center connector (to backplane bus) === */}
        <g>
          {/* "BUS" label */}
          <text x={connX} y={BOARD_H - 22} textAnchor="middle"
            dominantBaseline="auto" fill={silkDim} fontSize={4.5}
            fontFamily="'IBM Plex Mono', monospace" letterSpacing={0.5} opacity={0.55}>
            BUS
          </text>
          {/* Gold pad */}
          <rect x={connX - 10} y={BOARD_H - 14} width={20} height={8}
            fill={padColor} rx={1} opacity={0.8} />
          {/* 4 pin stubs extending down */}
          {Array.from({ length: 4 }, (_, i) => (
            <rect key={`bp-${i}`}
              x={connX - 6 + i * 4}
              y={BOARD_H - 6}
              width={2}
              height={6}
              fill={padColor} rx={0.3} opacity={0.6} />
          ))}
        </g>

        {/* === Mounting holes === */}
        <circle cx={14} cy={BOARD_H - 14} r={3.5}
          fill="none" stroke={silkDim} strokeWidth={0.7} opacity={0.35} />
        <circle cx={boardW - 14} cy={BOARD_H - 14} r={3.5}
          fill="none" stroke={silkDim} strokeWidth={0.7} opacity={0.35} />
      </svg>
    </div>
  );
});
SystemBoardNode.displayName = 'SystemBoardNode';
