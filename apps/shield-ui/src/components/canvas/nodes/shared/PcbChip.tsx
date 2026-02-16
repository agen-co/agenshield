/**
 * Reusable SVG-based IC chip wrapper for PCB motherboard aesthetic.
 * All canvas nodes use this component to render as IC chips with gull-wing pin legs.
 */

import { memo, type ReactNode } from 'react';
import { useTheme } from '@mui/material/styles';
import { pcb } from '../../styles/pcb-tokens';

export interface PcbChipProps {
  width: number;
  height: number;
  pinsTop?: number;
  pinsBottom?: number;
  pinsLeft?: number;
  pinsRight?: number;
  label: string;
  sublabel?: string;
  ledColor?: string;
  ledCount?: number;
  children?: ReactNode;
  variant?: 'standard' | 'bus' | 'connector';
  borderRadius?: number;
}

const PIN_LEAD_WIDTH = 1.5;
const PIN_LEAD_LENGTH = 5;
const PIN_PAD_WIDTH = 5;
const PIN_PAD_LENGTH = 4;
const PIN_TOTAL_LENGTH = PIN_LEAD_LENGTH + PIN_PAD_LENGTH; // 9px
const PIN_INSET = 8; // space from edge to first/last pin

export const PcbChip = memo(({
  width,
  height,
  pinsTop = 0,
  pinsBottom = 0,
  pinsLeft = 0,
  pinsRight = 0,
  label,
  sublabel,
  ledColor,
  ledCount = 1,
  children,
  variant = 'standard',
  borderRadius = 2,
}: PcbChipProps) => {
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';

  const bodyColor = isDark ? pcb.component.body : pcb.light.body;
  const silkColor = isDark ? pcb.silk.primary : pcb.light.silk;
  const silkDim = isDark ? pcb.silk.dim : '#6A6A5A';
  const pinColor = pcb.component.pin;
  const padColor = pcb.component.padGold;
  const borderColor = isDark ? 'rgba(136, 136, 136, 0.3)' : 'rgba(136, 136, 136, 0.5)';

  // Total SVG size includes pins extending outward
  const svgWidth = width + (pinsLeft > 0 ? PIN_TOTAL_LENGTH : 0) + (pinsRight > 0 ? PIN_TOTAL_LENGTH : 0);
  const svgHeight = height + (pinsTop > 0 ? PIN_TOTAL_LENGTH : 0) + (pinsBottom > 0 ? PIN_TOTAL_LENGTH : 0);

  // Body offset within SVG
  const bodyX = pinsLeft > 0 ? PIN_TOTAL_LENGTH : 0;
  const bodyY = pinsTop > 0 ? PIN_TOTAL_LENGTH : 0;

  function renderGullWingPins(
    count: number,
    side: 'top' | 'bottom' | 'left' | 'right',
  ) {
    if (count === 0) return null;
    const pins: React.ReactNode[] = [];

    for (let i = 0; i < count; i++) {
      if (side === 'top' || side === 'bottom') {
        const span = width - PIN_INSET * 2;
        const spacing = count > 1 ? span / (count - 1) : 0;
        const px = bodyX + PIN_INSET + (count > 1 ? i * spacing : span / 2);

        if (side === 'top') {
          // Lead: thin vertical line from chip edge upward
          const leadX = px;
          const leadBottom = bodyY;
          const leadTop = leadBottom - PIN_LEAD_LENGTH;
          // Solder pad: wider rectangle at tip
          const padTop = leadTop - PIN_PAD_LENGTH;

          pins.push(
            <g key={`pin-top-${i}`}>
              {/* Solder pad (gold tip) */}
              <rect
                x={padTop < 0 ? 0 : px - PIN_PAD_WIDTH / 2}
                y={padTop}
                width={PIN_PAD_WIDTH}
                height={PIN_PAD_LENGTH}
                fill={padColor}
                rx={0.5}
              />
              {/* Lead (thin gray line) */}
              <line
                x1={leadX}
                y1={leadTop}
                x2={leadX}
                y2={leadBottom}
                stroke={pinColor}
                strokeWidth={PIN_LEAD_WIDTH}
              />
            </g>,
          );
        } else {
          // bottom
          const leadX = px;
          const leadTop = bodyY + height;
          const leadBottom = leadTop + PIN_LEAD_LENGTH;
          const padTop = leadBottom;

          pins.push(
            <g key={`pin-bottom-${i}`}>
              {/* Lead */}
              <line
                x1={leadX}
                y1={leadTop}
                x2={leadX}
                y2={leadBottom}
                stroke={pinColor}
                strokeWidth={PIN_LEAD_WIDTH}
              />
              {/* Solder pad */}
              <rect
                x={px - PIN_PAD_WIDTH / 2}
                y={padTop}
                width={PIN_PAD_WIDTH}
                height={PIN_PAD_LENGTH}
                fill={padColor}
                rx={0.5}
              />
            </g>,
          );
        }
      } else {
        // left / right
        const span = height - PIN_INSET * 2;
        const spacing = count > 1 ? span / (count - 1) : 0;
        const py = bodyY + PIN_INSET + (count > 1 ? i * spacing : span / 2);

        if (side === 'left') {
          const leadRight = bodyX;
          const leadLeft = leadRight - PIN_LEAD_LENGTH;
          const padLeft = leadLeft - PIN_PAD_LENGTH;

          pins.push(
            <g key={`pin-left-${i}`}>
              {/* Solder pad */}
              <rect
                x={padLeft}
                y={py - PIN_PAD_WIDTH / 2}
                width={PIN_PAD_LENGTH}
                height={PIN_PAD_WIDTH}
                fill={padColor}
                rx={0.5}
              />
              {/* Lead */}
              <line
                x1={leadLeft}
                y1={py}
                x2={leadRight}
                y2={py}
                stroke={pinColor}
                strokeWidth={PIN_LEAD_WIDTH}
              />
            </g>,
          );
        } else {
          // right
          const leadLeft = bodyX + width;
          const leadRight = leadLeft + PIN_LEAD_LENGTH;
          const padLeft = leadRight;

          pins.push(
            <g key={`pin-right-${i}`}>
              {/* Lead */}
              <line
                x1={leadLeft}
                y1={py}
                x2={leadRight}
                y2={py}
                stroke={pinColor}
                strokeWidth={PIN_LEAD_WIDTH}
              />
              {/* Solder pad */}
              <rect
                x={padLeft}
                y={py - PIN_PAD_WIDTH / 2}
                width={PIN_PAD_LENGTH}
                height={PIN_PAD_WIDTH}
                fill={padColor}
                rx={0.5}
              />
            </g>,
          );
        }
      }
    }
    return pins;
  }

  // LED positions: top-right corner of chip body
  function renderLEDs() {
    if (!ledColor) return null;
    const leds: React.ReactNode[] = [];
    for (let i = 0; i < ledCount; i++) {
      const cx = bodyX + width - 10 - i * 12;
      const cy = bodyY + 10;
      const r = ledCount > 1 && i === Math.floor(ledCount / 2) ? 4 : 3;

      leds.push(
        <g key={`led-${i}`}>
          {ledColor !== pcb.component.ledOff && (
            <circle
              cx={cx}
              cy={cy}
              r={r + 3}
              fill={ledColor}
              opacity={0.25}
            />
          )}
          <circle
            cx={cx}
            cy={cy}
            r={r}
            fill={ledColor}
            filter={ledColor !== pcb.component.ledOff ? 'url(#pcb-glow-signal)' : undefined}
          />
        </g>,
      );
    }
    return leds;
  }

  return (
    <svg
      width={svgWidth}
      height={svgHeight}
      viewBox={`0 0 ${svgWidth} ${svgHeight}`}
      style={{ display: 'block', overflow: 'visible' }}
    >
      {/* Gull-wing pin legs */}
      {renderGullWingPins(pinsTop, 'top')}
      {renderGullWingPins(pinsBottom, 'bottom')}
      {renderGullWingPins(pinsLeft, 'left')}
      {renderGullWingPins(pinsRight, 'right')}

      {/* Chip body */}
      <rect
        x={bodyX}
        y={bodyY}
        width={width}
        height={height}
        fill={bodyColor}
        stroke={borderColor}
        strokeWidth={1}
        rx={borderRadius}
      />

      {/* Inner gradient overlay */}
      <rect
        x={bodyX}
        y={bodyY}
        width={width}
        height={height}
        fill="url(#pcb-chip-gradient)"
        rx={borderRadius}
        opacity={0.3}
      />

      {/* Pin-1 dot (orientation marker) */}
      <circle
        cx={bodyX + 8}
        cy={bodyY + 8}
        r={2.5}
        fill={silkDim}
        opacity={0.5}
      />

      {/* Bus variant: horizontal trace lines */}
      {variant === 'bus' && (
        <g opacity={0.15}>
          {[0.2, 0.35, 0.5, 0.65, 0.8].map((ratio, i) => (
            <line
              key={`trace-${i}`}
              x1={bodyX + 8}
              y1={bodyY + height * ratio}
              x2={bodyX + width - 8}
              y2={bodyY + height * ratio}
              stroke={pcb.trace.silver}
              strokeWidth={1}
            />
          ))}
        </g>
      )}

      {/* Connector variant: gold contact fingers along top */}
      {variant === 'connector' && (
        <g>
          {Array.from({ length: 10 }, (_, i) => {
            const fingerW = (width - 20) / 12;
            const fx = bodyX + 10 + i * (fingerW + 2);
            return (
              <rect
                key={`finger-${i}`}
                x={fx}
                y={bodyY}
                width={fingerW}
                height={6}
                fill={pcb.component.padGold}
                rx={1}
              />
            );
          })}
        </g>
      )}

      {/* Silkscreen label */}
      <text
        x={bodyX + width / 2}
        y={bodyY + height / 2 - (sublabel ? 4 : 0)}
        textAnchor="middle"
        dominantBaseline="central"
        fill={silkColor}
        fontSize={11}
        fontFamily="'IBM Plex Mono', monospace"
        fontWeight={600}
        letterSpacing={1}
      >
        {label.toUpperCase()}
      </text>

      {/* Sublabel */}
      {sublabel && (
        <text
          x={bodyX + width / 2}
          y={bodyY + height / 2 + 12}
          textAnchor="middle"
          dominantBaseline="central"
          fill={silkDim}
          fontSize={8}
          fontFamily="'IBM Plex Mono', monospace"
          letterSpacing={0.5}
        >
          {sublabel}
        </text>
      )}

      {/* Status LEDs */}
      {renderLEDs()}

      {/* Children slot — foreignObject for React content */}
      {children && (
        <foreignObject
          x={bodyX + 4}
          y={bodyY + 4}
          width={width - 8}
          height={height - 8}
        >
          <div
            style={{
              width: '100%',
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {children}
          </div>
        </foreignObject>
      )}
    </svg>
  );
});
PcbChip.displayName = 'PcbChip';
