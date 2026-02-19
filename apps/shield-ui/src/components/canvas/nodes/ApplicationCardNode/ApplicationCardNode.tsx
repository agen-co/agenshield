/**
 * ApplicationCardNode — redesigned PCB expansion card (300x180).
 *
 * Layout:
 *   - Core IC (U1) with app icon prominently displayed
 *   - OLED display (DSP1) showing running status and user context
 *   - 3 LED indicators (D1 PWR, D2 STS, D3 ACT)
 *   - Red triangle alert when running as root (privileged)
 *   - Dynamic skill/MCP sub-chips (or default U2 COMM / U3 MEM)
 *   - Instance badge when multiple instances of same type
 *
 * Handles: left-bus and right-bus (static, bus-facing), plus dynamic danger
 * handles from pin allocator (or fallback hardcoded positions).
 */

import React, { memo, useCallback } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Terminal, Globe, Monitor, Cpu } from 'lucide-react';
import { useTheme } from '@mui/material/styles';
import { pcb } from '../../styles/pcb-tokens';
import type { ApplicationCardData } from '../../Canvas.types';
import { openDrilldown } from '../../../../state/canvas-drilldown';

/* ---- Dimensions ---- */
const CARD_W = 300;
const CARD_H = 180;
const PIN_TOTAL = 9;       // side pin overhang
const SVG_W = CARD_W + PIN_TOTAL * 2;  // overhang on both sides
const BODY_X = PIN_TOTAL;  // card body starts here in SVG space

/* ---- Pin / pad proportions ---- */
const PAD_W = 3;
const PAD_L = 3;
const LEAD_W = 0.8;

/* ---- Sub-component geometry (SVG-space) ---- */
const CORE   = { x: BODY_X + 14,  y: 30, w: 120, h: 80 };
const SCREEN = { x: BODY_X + 148, y: 32, w: 78,  h: 34 };
const LED_X  = BODY_X + 240;
const LED_YS = [38, 54, 70];
const ALERT  = { x: BODY_X + CARD_W - 24, y: 10, size: 14 };

const CLK  = { x: BODY_X + 120, y: 126, w: 22, h: 12 };
const CAPS = [
  { x: BODY_X + 156, y: 122, ref: 'C1' },
  { x: BODY_X + 170, y: 122, ref: 'C2' },
  { x: BODY_X + 156, y: 134, ref: 'C3' },
  { x: BODY_X + 170, y: 134, ref: 'C4' },
];

/* ---- Card-specific palettes ---- */
const CARD_DARK = {
  body: '#161820',
  chipBody: '#191B20',
  chipBorder: 'rgba(60,60,60,0.25)',
  silk: '#707478',
  silkDim: '#4A4E52',
  trace: '#3A3C42',
  padGold: '#9A7A3A',
  padGoldActive: '#D4A04A',
  screenBg: '#0C0E12',
  screenBorder: '#2A2C30',
  screenRunning: '#6A8A6A',
  screenStopped: '#8A4A4A',
  screenUser: '#5A6A7A',
  screenRoot: '#8A4A3A',
};

const CARD_LIGHT = {
  body: '#F2F2EE',
  chipBody: '#E4E4DE',
  chipBorder: 'rgba(100,100,100,0.25)',
  silk: '#2A2A2A',
  silkDim: '#6A6A6A',
  trace: '#B0B0A8',
  padGold: '#C49030',
  padGoldActive: '#D4A04A',
  screenBg: '#E8E8E4',
  screenBorder: '#C0C0B8',
  screenRunning: '#2A6A2A',
  screenStopped: '#8A2A2A',
  screenUser: '#2A4A6A',
  screenRoot: '#7A2A1A',
};

const STATUS_LED: Record<string, string> = {
  unshielded: pcb.component.ledRed,
  shielding: pcb.component.ledAmber,
  shielded: pcb.component.ledGreen,
};

const ICON_MAP: Record<string, typeof Terminal> = {
  Terminal, Globe, Monitor, Cpu,
};

/** Brand SVG icons by app type (served from /icons/) */
const BRAND_ICONS: Record<string, string> = {
  openclaw: '/icons/openclaw.svg',
  'claude-code': '/icons/claude-code.svg',
};

/* ---- Helpers ---- */

/** Render QFP-style pins on sides of an IC. */
function renderIcPins(
  ic: { x: number; y: number; w: number; h: number },
  topBottomCount: number,
  sideCount: number,
  padColor: string,
  pinColor: string,
  opts?: { skipTop?: boolean },
) {
  const els: React.JSX.Element[] = [];
  for (let i = 0; i < topBottomCount; i++) {
    const px = ic.x + 8 + i * ((ic.w - 16) / Math.max(topBottomCount - 1, 1));
    if (!opts?.skipTop) {
      els.push(
        <g key={`t${i}`}>
          <rect x={px - PAD_W / 2} y={ic.y - PAD_L} width={PAD_W} height={PAD_L} fill={padColor} rx={0.4} />
          <line x1={px} y1={ic.y - PAD_L - 4} x2={px} y2={ic.y - PAD_L} stroke={pinColor} strokeWidth={LEAD_W} />
        </g>,
      );
    }
    els.push(
      <g key={`b${i}`}>
        <rect x={px - PAD_W / 2} y={ic.y + ic.h} width={PAD_W} height={PAD_L} fill={padColor} rx={0.4} />
        <line x1={px} y1={ic.y + ic.h + PAD_L} x2={px} y2={ic.y + ic.h + PAD_L + 4} stroke={pinColor} strokeWidth={LEAD_W} />
      </g>,
    );
  }
  for (let i = 0; i < sideCount; i++) {
    const py = ic.y + 6 + i * ((ic.h - 12) / Math.max(sideCount - 1, 1));
    els.push(
      <g key={`l${i}`}>
        <rect x={ic.x - PAD_L} y={py - PAD_W / 2} width={PAD_L} height={PAD_W} fill={padColor} rx={0.4} />
      </g>,
    );
    els.push(
      <g key={`r${i}`}>
        <rect x={ic.x + ic.w} y={py - PAD_W / 2} width={PAD_L} height={PAD_W} fill={padColor} rx={0.4} />
      </g>,
    );
  }
  return els;
}

/* ---- Max visible skill/MCP sub-chips ---- */
const MAX_VISIBLE_SUBCHIPS = 4;

export const ApplicationCardNode = memo(({ data }: NodeProps) => {
  const {
    id: cardId, name, type, version, binaryPath, status, icon, selected,
    isRunning, runAsRoot, currentUser, side,
    instanceIndex, instanceCount,
    skills, mcpServers,
    handleOverrides: dangerHandles,
  } = data as unknown as ApplicationCardData;

  const handleClick = useCallback(() => {
    openDrilldown(cardId);
  }, [cardId]);

  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';

  /* ---- Resolve palette ---- */
  const pal        = isDark ? CARD_DARK : CARD_LIGHT;
  const bodyColor  = pal.body;
  const silkColor  = pal.silk;
  const silkDim    = pal.silkDim;
  const borderClr  = selected ? (isDark ? pcb.trace.bright : '#333') : 'rgba(136,136,136,0.4)';
  const padColor   = pal.padGold;
  const pinColor   = pcb.component.pin;
  const chipBody   = pal.chipBody;
  const chipBorder = pal.chipBorder;
  const traceClr   = pal.trace;
  const ledColor   = STATUS_LED[status] ?? pcb.component.ledRed;
  const Icon       = ICON_MAP[icon] ?? Terminal;
  const traceOpacity = isDark ? 0.12 : 0.25;

  /* ---- Screen palette ---- */
  const screenBg     = pal.screenBg;
  const screenBorder = pal.screenBorder;
  const statusColor  = isRunning ? pal.screenRunning : pal.screenStopped;
  const userColor    = runAsRoot ? pal.screenRoot : pal.screenUser;
  const statusText   = isRunning ? 'RUNNING' : 'STOPPED';
  const userText     = runAsRoot
    ? 'USER: ROOT'
    : `USER: ${(currentUser || 'std').toUpperCase().slice(0, 8)}`;

  /* ---- LED definitions ---- */
  const leds = [
    { y: LED_YS[0], color: pcb.component.ledGreen, label: 'PWR', ref: 'D1', active: true },
    { y: LED_YS[1], color: ledColor, label: 'STS', ref: 'D2', active: status !== 'shielded' },
    { y: LED_YS[2], color: isRunning ? pcb.component.ledGreen : pcb.component.ledOff, label: 'ACT', ref: 'D3', active: !!isRunning },
  ];

  const serial = `SN:ASH-${(type || 'UNK').toUpperCase().slice(0, 4)}-001`;
  const pathTrunc = binaryPath
    ? (binaryPath.length > 28 ? `...${binaryPath.slice(-25)}` : binaryPath)
    : '';

  /* ---- Display name with instance badge ---- */
  const displayName = (instanceCount ?? 0) > 1
    ? `${name} #${(instanceIndex ?? 0) + 1}`
    : name;

  /* ---- Skill/MCP sub-chips ---- */
  const allSubChips = [
    ...(skills ?? []).map((s) => ({ id: s.id, label: s.name, active: s.active, type: 'skill' as const })),
    ...(mcpServers ?? []).map((m) => ({ id: m.id, label: m.name, active: m.active, type: 'mcp' as const })),
  ];
  const hasSubChips = allSubChips.length > 0;
  const visibleSubChips = allSubChips.slice(0, MAX_VISIBLE_SUBCHIPS);
  const overflowCount = allSubChips.length - MAX_VISIBLE_SUBCHIPS;

  /* ---- Bus connector pad position ---- */
  const busPadY = CARD_H / 2;

  return (
    <div style={{ position: 'relative', cursor: 'pointer' }} onClick={handleClick}>
      {/* === Static bus handles — always present === */}
      <Handle type="target" position={Position.Left} id="left-bus"
        style={{ top: CARD_H / 2, visibility: 'hidden' }} />
      <Handle type="target" position={Position.Right} id="right-bus"
        style={{ top: CARD_H / 2, left: SVG_W, visibility: 'hidden' }} />

      {/* === Danger wire handles — dynamic from pin allocator, or fallback to hardcoded === */}
      {(dangerHandles ?? [
        { id: 'danger-up', type: 'source' as const, position: Position.Top, offset: SVG_W / 2 - 3 },
        { id: 'danger-up-in', type: 'target' as const, position: Position.Top, offset: SVG_W / 2 + 3 },
        { id: 'danger-top-out', type: 'source' as const, position: Position.Top, offset: SVG_W / 2 - 30 },
        { id: 'danger-bottom-in', type: 'target' as const, position: Position.Bottom, offset: SVG_W / 2 },
      ]).map((spec) => (
        <Handle key={spec.id} type={spec.type} position={spec.position} id={spec.id}
          style={{
            ...(spec.position === Position.Top || spec.position === Position.Bottom
              ? { left: spec.offset ?? SVG_W / 2 }
              : { top: spec.offset ?? CARD_H / 2 }),
            ...(spec.position === Position.Right ? { left: SVG_W } : {}),
            visibility: 'hidden',
          }} />
      ))}

      <svg width={SVG_W} height={CARD_H} viewBox={`0 0 ${SVG_W} ${CARD_H}`}
        style={{ display: 'block', overflow: 'visible' }}>

        {/* === Bus connector pad (left side) === */}
        {(side === 'left' || !side) && (
          <g>
            <rect x={0} y={busPadY - PAD_W} width={PAD_L + 1} height={PAD_W * 2} fill={padColor} rx={0.5} />
            <line x1={PAD_L + 1} y1={busPadY} x2={PIN_TOTAL} y2={busPadY} stroke={pinColor} strokeWidth={LEAD_W} />
            {/* Additional lead stubs */}
            {[-8, 8].map((off) => (
              <g key={`ls-${off}`}>
                <rect x={0} y={busPadY + off - 1} width={PAD_L} height={2} fill={padColor} rx={0.3} opacity={0.5} />
                <line x1={PAD_L} y1={busPadY + off} x2={PIN_TOTAL} y2={busPadY + off} stroke={pinColor} strokeWidth={LEAD_W * 0.6} opacity={0.3} />
              </g>
            ))}
          </g>
        )}

        {/* === Bus connector pad (right side) === */}
        {side === 'right' && (
          <g>
            <rect x={SVG_W - PAD_L - 1} y={busPadY - PAD_W} width={PAD_L + 1} height={PAD_W * 2} fill={padColor} rx={0.5} />
            <line x1={BODY_X + CARD_W} y1={busPadY} x2={SVG_W - PAD_L - 1} y2={busPadY} stroke={pinColor} strokeWidth={LEAD_W} />
            {[-8, 8].map((off) => (
              <g key={`rs-${off}`}>
                <rect x={SVG_W - PAD_L} y={busPadY + off - 1} width={PAD_L} height={2} fill={padColor} rx={0.3} opacity={0.5} />
                <line x1={BODY_X + CARD_W} y1={busPadY + off} x2={SVG_W - PAD_L} y2={busPadY + off} stroke={pinColor} strokeWidth={LEAD_W * 0.6} opacity={0.3} />
              </g>
            ))}
          </g>
        )}

        {/* === Card body === */}
        <rect x={BODY_X} y={0} width={CARD_W} height={CARD_H}
          fill={bodyColor} stroke={borderClr} strokeWidth={selected ? 2 : 1} rx={3} />
        <rect x={BODY_X} y={0} width={CARD_W} height={CARD_H}
          fill="url(#pcb-chip-gradient)" rx={3} opacity={0.3} />

        {/* === Top silkscreen: app name + version === */}
        <circle cx={BODY_X + 12} cy={20} r={1.5} fill={silkDim} opacity={0.5} />
        <text x={BODY_X + 18} y={21} dominantBaseline="central"
          fontFamily="'IBM Plex Mono', monospace">
          <tspan fill={silkColor} fontSize={8} fontWeight={700} letterSpacing={0.8}>
            {displayName.toUpperCase()}
          </tspan>
          {version && (
            <tspan fill={silkDim} fontSize={6} letterSpacing={0.3}>
              {`  v${version}`}
            </tspan>
          )}
        </text>

        {/* ================================================================
            ROOT ALERT TRIANGLE
            ================================================================ */}
        {runAsRoot && (
          <g style={{ animation: 'pcb-alert-blink 1.2s ease-in-out infinite' }}>
            <circle cx={ALERT.x + ALERT.size / 2} cy={ALERT.y + ALERT.size / 2 + 2}
              r={ALERT.size} fill="#D43F3F" opacity={0.08}
              style={{ animation: 'pcb-alert-glow 1.2s ease-in-out infinite' }} />
            <polygon
              points={`${ALERT.x + ALERT.size / 2},${ALERT.y} ${ALERT.x},${ALERT.y + ALERT.size} ${ALERT.x + ALERT.size},${ALERT.y + ALERT.size}`}
              fill="#D43F3F" stroke="#FF5252" strokeWidth={0.5} />
            <text x={ALERT.x + ALERT.size / 2} y={ALERT.y + ALERT.size - 2.5}
              textAnchor="middle" dominantBaseline="central"
              fill="#FFFFFF" fontSize={8} fontFamily="'IBM Plex Mono', monospace"
              fontWeight={800}>!</text>
          </g>
        )}

        {/* ================================================================
            SIGNAL TRACES
            ================================================================ */}
        <g opacity={traceOpacity} stroke={traceClr} fill="none" strokeWidth={0.8}>
          {/* Horizontal signal bus at y=18 */}
          <line x1={BODY_X + 20} y1={18} x2={BODY_X + CARD_W - 20} y2={18} />
          {/* Bus connector trace */}
          {side === 'right' ? (
            <line x1={BODY_X + CARD_W - 20} y1={18} x2={BODY_X + CARD_W} y2={busPadY} />
          ) : (
            <line x1={BODY_X + 20} y1={18} x2={BODY_X} y2={busPadY} />
          )}
          {/* Bus -> Core IC */}
          <path d={`M ${CORE.x + 20} 18 V ${CORE.y}`} />
          <path d={`M ${CORE.x + 60} 18 V ${CORE.y}`} />
          <path d={`M ${CORE.x + 100} 18 V ${CORE.y}`} />
        </g>

        {/* Core -> Screen trace */}
        <g opacity={traceOpacity * 0.8} stroke={traceClr} fill="none" strokeWidth={0.6}>
          <line x1={CORE.x + CORE.w + PAD_L} y1={CORE.y + 20}
                x2={SCREEN.x} y2={SCREEN.y + 10} />
        </g>

        {/* Core -> Peripherals */}
        <g opacity={traceOpacity * 0.8} stroke={traceClr} fill="none" strokeWidth={0.6}>
          <path d={`M ${CORE.x + 30} ${CORE.y + CORE.h + PAD_L + 4} V 122`} />
          <path d={`M ${CORE.x + 80} ${CORE.y + CORE.h + PAD_L + 4} V 122`} />
        </g>

        {/* LED traces */}
        <g opacity={traceOpacity * 0.8} stroke={traceClr} fill="none" strokeWidth={0.5}>
          {leds.map((led, i) => (
            <line key={`lt-${i}`}
              x1={CORE.x + CORE.w + PAD_L + 4} y1={CORE.y + 15 + i * 20}
              x2={LED_X - 5} y2={led.y} />
          ))}
        </g>

        {/* ================================================================
            CORE IC (U1)
            ================================================================ */}
        <rect x={CORE.x} y={CORE.y} width={CORE.w} height={CORE.h}
          fill={chipBody} stroke={chipBorder} strokeWidth={0.5} rx={2} />
        <rect x={CORE.x} y={CORE.y} width={CORE.w} height={CORE.h}
          fill="url(#pcb-chip-gradient)" rx={2} opacity={0.4} />
        {renderIcPins(CORE, 10, 8, padColor, pinColor, { skipTop: true })}
        <circle cx={CORE.x + 5} cy={CORE.y + 5} r={1.5} fill={silkDim} opacity={0.6} />
        <text x={CORE.x + CORE.w - 4} y={CORE.y + 6} textAnchor="end"
          fill={silkDim} fontSize={4.5} fontFamily="'IBM Plex Mono', monospace"
          letterSpacing={0.3} opacity={0.5}>U1</text>

        {/* App icon */}
        {BRAND_ICONS[type] ? (
          <image
            href={BRAND_ICONS[type]}
            x={CORE.x + CORE.w / 2 - 14}
            y={CORE.y + CORE.h / 2 - 19}
            width={28}
            height={28}
          />
        ) : (
          <foreignObject x={CORE.x + CORE.w / 2 - 15} y={CORE.y + CORE.h / 2 - 18} width={30} height={30}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
              <Icon size={24} color={isDark ? pcb.trace.bright : '#555'} />
            </div>
          </foreignObject>
        )}

        <text x={CORE.x + CORE.w / 2} y={CORE.y + CORE.h - 8}
          textAnchor="middle" dominantBaseline="central"
          fill={silkDim} fontSize={5} fontFamily="'IBM Plex Mono', monospace"
          letterSpacing={0.8} opacity={0.4}>
          MAIN PROCESSOR
        </text>

        {/* ================================================================
            SCREEN / DISPLAY (DSP1)
            ================================================================ */}
        <text x={SCREEN.x} y={SCREEN.y - 3} fill={silkDim} fontSize={4}
          fontFamily="'IBM Plex Mono', monospace" letterSpacing={0.3} opacity={0.5}>
          DISPLAY
        </text>
        <text x={SCREEN.x + SCREEN.w + 3} y={SCREEN.y + 4} fill={silkDim} fontSize={3.5}
          fontFamily="'IBM Plex Mono', monospace" opacity={0.4}>DSP1</text>
        <rect x={SCREEN.x} y={SCREEN.y} width={SCREEN.w} height={SCREEN.h}
          fill={screenBg} stroke={screenBorder} strokeWidth={0.5} rx={2} />
        <text x={SCREEN.x + 5} y={SCREEN.y + 12} dominantBaseline="central"
          fill={statusColor} fontSize={6} fontFamily="'IBM Plex Mono', monospace"
          fontWeight={600} letterSpacing={0.5}>
          {statusText}
        </text>
        <text x={SCREEN.x + 5} y={SCREEN.y + 24} dominantBaseline="central"
          fill={userColor} fontSize={5} fontFamily="'IBM Plex Mono', monospace"
          letterSpacing={0.3}>
          {userText}
        </text>

        {/* ================================================================
            SMD LEDs (D1-D3)
            ================================================================ */}
        {leds.map((led) => {
          const lensAnim = led.active
            ? led.ref === 'D3'
              ? 'pcb-led-blink 0.8s ease-in-out infinite'
              : 'pcb-led-pulse 2s ease-in-out infinite'
            : undefined;
          const glowAnim = led.active
            ? 'pcb-led-glow-breathe 2s ease-in-out infinite'
            : undefined;

          return (
            <g key={led.ref}>
              <circle cx={LED_X} cy={led.y + 1.5} r={led.active ? 8 : 4}
                fill={led.color} opacity={led.active ? 0.25 : 0.04}
                style={glowAnim ? { animation: glowAnim } : undefined} />
              <rect x={LED_X - 5} y={led.y} width={2} height={3} fill={padColor} rx={0.3} />
              <rect x={LED_X + 3} y={led.y} width={2} height={3} fill={padColor} rx={0.3} />
              <rect x={LED_X - 3} y={led.y} width={6} height={3}
                fill={isDark ? pcb.component.bodyLight : '#e0e0d8'} stroke={chipBorder} strokeWidth={0.3} rx={0.5} />
              <rect x={LED_X - 1.5} y={led.y + 0.5} width={3} height={2}
                fill={led.color} rx={0.5} opacity={led.active ? 0.9 : 0.25}
                style={lensAnim ? { animation: lensAnim } : undefined} />
              {led.active && (
                <circle cx={LED_X} cy={led.y + 1.5} r={0.8} fill="white" opacity={0.6} />
              )}
              <text x={LED_X} y={led.y + 9} textAnchor="middle" fill={silkDim}
                fontSize={3.5} fontFamily="'IBM Plex Mono', monospace" opacity={0.6}>
                {led.label}
              </text>
              <text x={LED_X + 8} y={led.y + 2} fill={silkDim} fontSize={3}
                fontFamily="'IBM Plex Mono', monospace" opacity={0.4}>{led.ref}</text>
            </g>
          );
        })}

        {/* ================================================================
            SKILL / MCP SUB-CHIPS (or default COMM/MEM)
            ================================================================ */}
        {hasSubChips ? (
          <g>
            {visibleSubChips.map((sc, i) => {
              const col = i % 2;
              const row = Math.floor(i / 2);
              const scX = BODY_X + 14 + col * 52;
              const scY = 122 + row * 24;
              const scW = 42;
              const scH = 18;
              const scLed = sc.active ? pcb.component.ledGreen : pcb.component.ledOff;
              return (
                <g key={sc.id}>
                  <rect x={scX} y={scY} width={scW} height={scH}
                    fill={chipBody} stroke={chipBorder} strokeWidth={0.3} rx={1.5} />
                  {/* 2 side pins */}
                  <rect x={scX - 2} y={scY + 4} width={2} height={3} fill={padColor} rx={0.3} />
                  <rect x={scX - 2} y={scY + scH - 7} width={2} height={3} fill={padColor} rx={0.3} />
                  <rect x={scX + scW} y={scY + 4} width={2} height={3} fill={padColor} rx={0.3} />
                  <rect x={scX + scW} y={scY + scH - 7} width={2} height={3} fill={padColor} rx={0.3} />
                  {/* Label */}
                  <text x={scX + 3} y={scY + scH / 2} dominantBaseline="central"
                    fill={silkColor} fontSize={4} fontFamily="'IBM Plex Mono', monospace"
                    fontWeight={600} letterSpacing={0.3}>
                    {sc.label.toUpperCase().slice(0, 6)}
                  </text>
                  {/* LED dot */}
                  <circle cx={scX + scW - 5} cy={scY + scH / 2} r={2} fill={scLed} opacity={0.6} />
                </g>
              );
            })}
            {/* Overflow badge */}
            {overflowCount > 0 && (
              <text x={BODY_X + 120} y={134} dominantBaseline="central"
                fill={silkDim} fontSize={5} fontFamily="'IBM Plex Mono', monospace"
                fontWeight={600} opacity={0.6}>
                +{overflowCount}
              </text>
            )}
          </g>
        ) : (
          <g>
            {/* Default COMM (U2) */}
            <rect x={BODY_X + 14} y={122} width={42} height={22}
              fill={chipBody} stroke={chipBorder} strokeWidth={0.5} rx={2} />
            <rect x={BODY_X + 14} y={122} width={42} height={22}
              fill="url(#pcb-chip-gradient)" rx={2} opacity={0.4} />
            {Array.from({ length: 3 }, (_, i) => {
              const py = 122 + 4 + i * 7;
              return (
                <g key={`cp-${i}`}>
                  <rect x={BODY_X + 14 - PAD_L} y={py - PAD_W / 2} width={PAD_L} height={PAD_W} fill={padColor} rx={0.4} />
                  <rect x={BODY_X + 14 + 42} y={py - PAD_W / 2} width={PAD_L} height={PAD_W} fill={padColor} rx={0.4} />
                </g>
              );
            })}
            <text x={BODY_X + 35} y={133} textAnchor="middle"
              dominantBaseline="central" fill={silkColor} fontSize={5.5}
              fontFamily="'IBM Plex Mono', monospace" fontWeight={700} letterSpacing={0.5}>
              COMM
            </text>
            <text x={BODY_X + 54} y={120} textAnchor="end"
              fill={silkDim} fontSize={3.5} fontFamily="'IBM Plex Mono', monospace" opacity={0.5}>U2</text>

            {/* Default MEM (U3) */}
            <rect x={BODY_X + 66} y={122} width={42} height={22}
              fill={chipBody} stroke={chipBorder} strokeWidth={0.5} rx={2} />
            <rect x={BODY_X + 66} y={122} width={42} height={22}
              fill="url(#pcb-chip-gradient)" rx={2} opacity={0.4} />
            {Array.from({ length: 3 }, (_, i) => {
              const py = 122 + 4 + i * 7;
              return (
                <g key={`mp-${i}`}>
                  <rect x={BODY_X + 66 - PAD_L} y={py - PAD_W / 2} width={PAD_L} height={PAD_W} fill={padColor} rx={0.4} />
                  <rect x={BODY_X + 66 + 42} y={py - PAD_W / 2} width={PAD_L} height={PAD_W} fill={padColor} rx={0.4} />
                </g>
              );
            })}
            <text x={BODY_X + 87} y={133} textAnchor="middle"
              dominantBaseline="central" fill={silkColor} fontSize={5.5}
              fontFamily="'IBM Plex Mono', monospace" fontWeight={700} letterSpacing={0.5}>
              MEM
            </text>
            <text x={BODY_X + 106} y={120} textAnchor="end"
              fill={silkDim} fontSize={3.5} fontFamily="'IBM Plex Mono', monospace" opacity={0.5}>U3</text>
          </g>
        )}

        {/* ================================================================
            CLK (Y1) — crystal oscillator
            ================================================================ */}
        <rect x={CLK.x} y={CLK.y} width={CLK.w} height={CLK.h}
          fill={chipBody} stroke={chipBorder} strokeWidth={0.5} rx={2} />
        <rect x={CLK.x - 2} y={CLK.y + 2} width={2.5} height={3} fill={padColor} rx={0.3} />
        <rect x={CLK.x - 2} y={CLK.y + CLK.h - 5} width={2.5} height={3} fill={padColor} rx={0.3} />
        <rect x={CLK.x + CLK.w - 0.5} y={CLK.y + 2} width={2.5} height={3} fill={padColor} rx={0.3} />
        <rect x={CLK.x + CLK.w - 0.5} y={CLK.y + CLK.h - 5} width={2.5} height={3} fill={padColor} rx={0.3} />
        <text x={CLK.x + CLK.w / 2} y={CLK.y + CLK.h / 2} textAnchor="middle"
          dominantBaseline="central" fill={silkDim} fontSize={4.5}
          fontFamily="'IBM Plex Mono', monospace">CLK</text>
        <text x={CLK.x + CLK.w + 2} y={CLK.y - 1} fill={silkDim} fontSize={3.5}
          fontFamily="'IBM Plex Mono', monospace" opacity={0.5}>Y1</text>

        {/* ================================================================
            CAPACITORS (C1-C4)
            ================================================================ */}
        {CAPS.map((c) => (
          <g key={c.ref}>
            <rect x={c.x} y={c.y} width={6} height={3} fill={chipBody} stroke={chipBorder}
              strokeWidth={0.3} rx={0.5} />
            <rect x={c.x - 1.5} y={c.y + 0.5} width={1.5} height={2} fill={padColor} rx={0.3} />
            <rect x={c.x + 6} y={c.y + 0.5} width={1.5} height={2} fill={padColor} rx={0.3} />
            <text x={c.x + 3} y={c.y - 2} textAnchor="middle" fill={silkDim} fontSize={3}
              fontFamily="'IBM Plex Mono', monospace" opacity={0.4}>{c.ref}</text>
          </g>
        ))}

        {/* ================================================================
            BOTTOM SILKSCREEN
            ================================================================ */}
        <text x={BODY_X + 14} y={CARD_H - 18} dominantBaseline="central"
          fill={silkDim} fontSize={5.5} fontFamily="'IBM Plex Mono', monospace"
          letterSpacing={0.4} opacity={0.55}>
          {serial}  REV:A  {type || ''}
        </text>
        {pathTrunc && (
          <text x={BODY_X + 14} y={CARD_H - 8} dominantBaseline="central"
            fill={silkDim} fontSize={5} fontFamily="'IBM Plex Mono', monospace"
            letterSpacing={0.3} opacity={0.4}>
            {pathTrunc}
          </text>
        )}

        {/* ================================================================
            MOUNTING HOLES
            ================================================================ */}
        <circle cx={BODY_X + 10} cy={CARD_H - 10} r={3.5}
          fill="none" stroke={silkDim} strokeWidth={0.7} opacity={0.35} />
        <circle cx={BODY_X + CARD_W - 10} cy={CARD_H - 10} r={3.5}
          fill="none" stroke={silkDim} strokeWidth={0.7} opacity={0.35} />

        {/* Connection pads at danger handle positions */}
        {dangerHandles && (
          <g>
            {dangerHandles
              .filter(h => h.position === Position.Top)
              .map(h => (
                <g key={`pad-${h.id}`}>
                  <rect x={(h.offset ?? SVG_W / 2) - 1.75} y={-4} width={3.5} height={4}
                    fill={padColor} rx={0.5} />
                  <line x1={h.offset ?? SVG_W / 2} y1={-4} x2={h.offset ?? SVG_W / 2} y2={-8}
                    stroke={pinColor} strokeWidth={1} />
                </g>
              ))}
            {dangerHandles
              .filter(h => h.position === Position.Bottom)
              .map(h => (
                <g key={`pad-${h.id}`}>
                  <rect x={(h.offset ?? SVG_W / 2) - 1.75} y={CARD_H} width={3.5} height={4}
                    fill={padColor} rx={0.5} />
                  <line x1={h.offset ?? SVG_W / 2} y1={CARD_H + 4} x2={h.offset ?? SVG_W / 2} y2={CARD_H + 8}
                    stroke={pinColor} strokeWidth={1} />
                </g>
              ))}
          </g>
        )}

        {/* Selected glow */}
        {selected && (
          <rect x={BODY_X - 1} y={-1} width={CARD_W + 2} height={CARD_H + 2}
            fill="none" stroke={pcb.trace.bright} strokeWidth={1.5} rx={4}
            opacity={0.4} filter="url(#pcb-glow-copper)" />
        )}

        {/* ================================================================
            EXPOSED OVERLAY (when unshielded)
            ================================================================ */}
        {status === 'unshielded' && (
          <g>
            {/* Pulsing red border */}
            <rect x={BODY_X - 1} y={-1} width={CARD_W + 2} height={CARD_H + 2}
              fill="none" stroke="#E1583E" strokeWidth={1.5} rx={4}
              style={{ animation: 'danger-card-pulse 2s ease-in-out infinite' }} />

            {/* Faint red wash on Core IC */}
            <rect x={CORE.x} y={CORE.y} width={CORE.w} height={CORE.h}
              fill="#E1583E" rx={2} opacity={0.08}
              style={{ animation: 'danger-chip-breathe 2s ease-in-out infinite' }} />

            {/* "EXPOSED" text next to screen */}
            <text x={SCREEN.x + SCREEN.w + 6} y={SCREEN.y + SCREEN.h + 8}
              dominantBaseline="central"
              fill="#E1583E" fontSize={5.5} fontFamily="'IBM Plex Mono', monospace"
              fontWeight={700} letterSpacing={0.8}
              style={{ animation: 'pcb-alert-blink 1.2s ease-in-out infinite' }}>
              EXPOSED
            </text>
          </g>
        )}
      </svg>
    </div>
  );
});
ApplicationCardNode.displayName = 'ApplicationCardNode';
