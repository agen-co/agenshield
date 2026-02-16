/**
 * Shared PCB trace edge component.
 *
 * Renders orthogonal (Manhattan-style) SVG paths with optional via pads
 * at bend points and endpoints. All 4 edge types delegate to this component
 * with their own styling config.
 */

import { memo } from 'react';
import type { EdgeProps } from '@xyflow/react';
import {
  computeOrthogonalRoute,
  getViaPadPositions,
} from '../../utils/orthogonalRouter';

export interface PcbTraceEdgeConfig {
  strokeColor: string;
  strokeWidth: number;
  strokeDasharray?: string;
  opacity?: number;
  showViaPads?: boolean;
  glowFilter?: string;
  channelOffset?: number;
}

interface PcbTraceEdgeProps extends EdgeProps {
  config: PcbTraceEdgeConfig;
}

const VIA_PAD_R_OUTER = 5;
const VIA_PAD_R_INNER = 2;
const VIA_PAD_STROKE = 1.5;

export const PcbTraceEdge = memo(
  ({
    id,
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    markerStart,
    markerEnd,
    interactionWidth,
    config,
  }: PcbTraceEdgeProps) => {
    const route = computeOrthogonalRoute(
      { x: sourceX, y: sourceY },
      { x: targetX, y: targetY },
      sourcePosition,
      targetPosition,
      { channelOffset: config.channelOffset },
    );

    const viaPads = config.showViaPads ? getViaPadPositions(route.waypoints) : [];
    const opacity = config.opacity ?? 1;

    return (
      <g>
        {/* Main trace path */}
        <path
          d={route.path}
          fill="none"
          stroke={config.strokeColor}
          strokeWidth={config.strokeWidth}
          strokeDasharray={config.strokeDasharray}
          opacity={opacity}
          filter={config.glowFilter}
          markerStart={markerStart}
          markerEnd={markerEnd}
          style={{ pointerEvents: 'visibleStroke' }}
          data-testid={`edge-${id}`}
        />

        {/* Interaction widener (invisible wider path for hover/click) */}
        <path
          d={route.path}
          fill="none"
          stroke="transparent"
          strokeWidth={interactionWidth ?? 20}
        />

        {/* Via pads at bend points */}
        {viaPads.map((pt, i) => (
          <g key={`via-${i}`}>
            <circle
              cx={pt.x}
              cy={pt.y}
              r={VIA_PAD_R_OUTER}
              fill="none"
              stroke="#888888"
              strokeWidth={VIA_PAD_STROKE}
              opacity={opacity * 0.5}
            />
            <circle
              cx={pt.x}
              cy={pt.y}
              r={VIA_PAD_R_INNER}
              fill="#888888"
              opacity={opacity * 0.4}
            />
          </g>
        ))}

        {/* Endpoint via pads */}
        {config.showViaPads && (
          <>
            <circle
              cx={sourceX}
              cy={sourceY}
              r={VIA_PAD_R_OUTER + 1}
              fill="none"
              stroke="#888888"
              strokeWidth={VIA_PAD_STROKE + 0.5}
              opacity={opacity * 0.5}
            />
            <circle
              cx={sourceX}
              cy={sourceY}
              r={VIA_PAD_R_INNER + 1}
              fill="#888888"
              opacity={opacity * 0.4}
            />
            <circle
              cx={targetX}
              cy={targetY}
              r={VIA_PAD_R_OUTER + 1}
              fill="none"
              stroke="#888888"
              strokeWidth={VIA_PAD_STROKE + 0.5}
              opacity={opacity * 0.5}
            />
            <circle
              cx={targetX}
              cy={targetY}
              r={VIA_PAD_R_INNER + 1}
              fill="#888888"
              opacity={opacity * 0.4}
            />
          </>
        )}
      </g>
    );
  },
);
PcbTraceEdge.displayName = 'PcbTraceEdge';
