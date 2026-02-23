/**
 * DangerWireEdge — thick red danger wires for unprotected connections.
 *
 * Three visual variants based on `data.variant`:
 *   - primary: Bus -> card main wires (thick, pulsing)
 *   - penetration: Card -> system component wires (crawling dashes)
 *   - tendril: Cross-agent contamination wires (thin, slow crawl)
 *
 * Delegates rendering to PcbTraceEdge with variant-specific config.
 */

import { memo } from 'react';
import type { EdgeProps } from '@xyflow/react';
import { PcbTraceEdge, type PcbTraceEdgeConfig } from '../PcbTraceEdge';
import type { DangerWireData } from '../../Canvas.types';

const VARIANT_CONFIGS: Record<DangerWireData['variant'], PcbTraceEdgeConfig> = {
  primary: {
    strokeColor: '#E1583E',
    strokeWidth: 4.0,
    opacity: 0.35,
    pathStyle: { filter: 'drop-shadow(0 0 3px rgba(225,88,62,0.35))' },
    showViaPads: false,
    chamferRadius: 10,
    electricShots: {
      pulseWidth: 40, color: '#FF6B4F', opacity: 0.9,
      minInterval: 800, maxInterval: 2000,
      minDuration: 500, maxDuration: 900,
      maxConcurrent: 2,
    },
  },
  penetration: {
    strokeColor: '#E1583E',
    strokeWidth: 3.5,
    opacity: 0.4,
    pathStyle: { filter: 'drop-shadow(0 0 3px rgba(225,88,62,0.3))' },
    showViaPads: false,
    chamferRadius: 8,
    electricShots: {
      pulseWidth: 28, color: '#FF6B4F', opacity: 0.75,
      minInterval: 1500, maxInterval: 4000,
      minDuration: 400, maxDuration: 700,
      maxConcurrent: 1,
    },
  },
  tendril: {
    strokeColor: '#CC3333',
    strokeWidth: 2.0,
    strokeDasharray: '6 4',
    opacity: 0.15,
    showViaPads: false,
    chamferRadius: 6,
    electricShots: {
      pulseWidth: 15, color: '#E04444', opacity: 0.5,
      minInterval: 3000, maxInterval: 6000,
      minDuration: 600, maxDuration: 1200,
      maxConcurrent: 1,
    },
  },
  shield: {
    strokeColor: '#2D6B3F',
    strokeWidth: 3.0,
    opacity: 0.3,
    pathStyle: { filter: 'drop-shadow(0 0 2px rgba(45,107,63,0.3))' },
    showViaPads: false,
    chamferRadius: 10,
    electricShots: {
      pulseWidth: 30, color: '#3DA05A', opacity: 0.8,
      minInterval: 2000, maxInterval: 5000,
      minDuration: 500, maxDuration: 1000,
      maxConcurrent: 1,
      timerDriven: false,
    },
  },
  shielding: {
    strokeColor: '#E8A030',
    strokeWidth: 3.5,
    opacity: 0.4,
    pathStyle: { filter: 'drop-shadow(0 0 3px rgba(232,160,48,0.35))' },
    showViaPads: false,
    chamferRadius: 10,
    electricShots: {
      pulseWidth: 35, color: '#F0B848', opacity: 0.85,
      minInterval: 400, maxInterval: 1000,
      minDuration: 400, maxDuration: 800,
      maxConcurrent: 2,
      timerDriven: true,
    },
  },
};

export const DangerWireEdge = memo((props: EdgeProps) => {
  const data = props.data as DangerWireData | undefined;
  const variant = data?.variant ?? 'primary';
  const channelOffset = data?.channelOffset ?? 0;
  const targetRow = props.data?.targetRow as number | undefined;
  const channelCenterY = props.data?.channelCenterY as number | undefined;
  const channelSpacing = props.data?.channelSpacing as number | undefined;
  const fanout = (props.data?.fanout as boolean) ?? false;
  const eventDriven = (props.data?.eventDriven as boolean) ?? false;
  const timerDriven = props.data?.timerDriven as boolean | undefined;

  const baseConfig = VARIANT_CONFIGS[variant];

  // Merge health-based color overrides when present
  const config: PcbTraceEdgeConfig = data?.colorOverride
    ? {
        ...baseConfig,
        strokeColor: data.colorOverride,
        pathStyle: {
          ...baseConfig.pathStyle,
          filter: `drop-shadow(0 0 2px ${data.colorOverride}40)`,
        },
        electricShots: baseConfig.electricShots
          ? { ...baseConfig.electricShots, color: data.electricColorOverride ?? data.colorOverride }
          : undefined,
      }
    : baseConfig;

  const wrapperStyle = props.style as React.CSSProperties | undefined;

  return (
    <g style={wrapperStyle}>
      <PcbTraceEdge
        {...props}
        config={{
          ...config,
          channelOffset,
          targetRow,
          channelCenterY,
          channelSpacing,
          fanout,
          stubTop: (data?.stubTop as number) ?? 15,
          stubBottom: (data?.stubBottom as number) ?? 15,
          balanced: (data?.balanced as boolean) ?? false,
          edgeId: props.id,
          eventDriven,
          ...(timerDriven != null ? {
            electricShots: config.electricShots
              ? { ...config.electricShots, timerDriven }
              : undefined,
          } : {}),
        }}
      />
    </g>
  );
});
DangerWireEdge.displayName = 'DangerWireEdge';
