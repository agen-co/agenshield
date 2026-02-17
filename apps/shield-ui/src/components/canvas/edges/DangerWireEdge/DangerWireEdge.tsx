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
    strokeWidth: 2.5,
    opacity: 0.35,
    glowFilter: 'url(#danger-wire-glow)',
    showViaPads: false,
    chamferRadius: 10,
    electricShots: {
      pulseWidth: 30, color: '#FF6B4F', opacity: 0.9,
      filter: 'url(#danger-wire-glow)',
      minInterval: 600, maxInterval: 1600,
      minDuration: 500, maxDuration: 900,
      maxConcurrent: 3,
    },
  },
  penetration: {
    strokeColor: '#E1583E',
    strokeWidth: 1.5,
    opacity: 0.25,
    glowFilter: 'url(#canvas-glow-red)',
    showViaPads: false,
    chamferRadius: 8,
    electricShots: {
      pulseWidth: 18, color: '#FF6B4F', opacity: 0.65,
      minInterval: 1000, maxInterval: 3000,
      minDuration: 400, maxDuration: 700,
      maxConcurrent: 2,
    },
  },
  tendril: {
    strokeColor: '#CC3333',
    strokeWidth: 1.0,
    strokeDasharray: '6 4',
    opacity: 0.15,
    showViaPads: false,
    chamferRadius: 6,
    electricShots: {
      pulseWidth: 10, color: '#E04444', opacity: 0.5,
      minInterval: 1500, maxInterval: 4000,
      minDuration: 600, maxDuration: 1200,
      maxConcurrent: 2,
    },
  },
  shield: {
    strokeColor: '#2D6B3F',
    strokeWidth: 1.8,
    opacity: 0.3,
    glowFilter: 'url(#shield-trace-glow)',
    showViaPads: false,
    chamferRadius: 10,
    electricShots: {
      pulseWidth: 22, color: '#3DA05A', opacity: 0.8,
      filter: 'url(#shield-trace-glow)',
      minInterval: 1200, maxInterval: 3500,
      minDuration: 500, maxDuration: 1000,
      maxConcurrent: 2,
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

  const baseConfig = VARIANT_CONFIGS[variant];

  return (
    <PcbTraceEdge
      {...props}
      config={{
        ...baseConfig,
        channelOffset,
        targetRow,
        channelCenterY,
        channelSpacing,
        fanout,
        stubTop: 15,
        stubBottom: 15,
      }}
    />
  );
});
DangerWireEdge.displayName = 'DangerWireEdge';
