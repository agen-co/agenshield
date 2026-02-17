/**
 * Shared PCB trace edge component.
 *
 * Renders orthogonal (Manhattan-style) SVG paths with optional via pads
 * at bend points and endpoints. All 4 edge types delegate to this component
 * with their own styling config.
 */

import { memo, useRef } from 'react';
import type { EdgeProps } from '@xyflow/react';
import {
  computeOrthogonalRoute,
  computeMultiRowRoute,
  computeFanoutRoute,
  getViaPadPositions,
} from '../../utils/orthogonalRouter';
import { useElectricShots, type ElectricShotsConfig } from '../../hooks/useElectricShots';

export interface PcbTraceEdgeConfig {
  strokeColor: string;
  strokeWidth: number;
  strokeDasharray?: string;
  opacity?: number;
  showViaPads?: boolean;
  glowFilter?: string;
  channelOffset?: number;
  chamferRadius?: number;
  viaPadColor?: string;
  targetRow?: number;
  channelCenterY?: number;
  channelSpacing?: number;
  // V-D-V fanout mode
  fanout?: boolean;
  stubTop?: number;
  stubBottom?: number;
  pathStyle?: React.CSSProperties;
  electricShots?: ElectricShotsConfig;
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
    const isFanout = config.fanout === true;
    const isMultiRow = !isFanout && config.targetRow != null && config.targetRow >= 0 && config.channelCenterY != null;

    const route = isFanout
      ? computeFanoutRoute(
          { x: sourceX, y: sourceY },
          { x: targetX, y: targetY },
          { stubTop: config.stubTop, stubBottom: config.stubBottom, chamferRadius: config.chamferRadius },
        )
      : isMultiRow
        ? computeMultiRowRoute(
            { x: sourceX, y: sourceY },
            { x: targetX, y: targetY },
            config.targetRow!,
            config.channelCenterY!,
            config.channelOffset ?? 0,
            { channelSpacing: config.channelSpacing, chamferRadius: config.chamferRadius },
          )
        : computeOrthogonalRoute(
            { x: sourceX, y: sourceY },
            { x: targetX, y: targetY },
            sourcePosition,
            targetPosition,
            { channelOffset: config.channelOffset, chamferRadius: config.chamferRadius },
          );

    const shotContainerRef = useRef<SVGGElement>(null);
    useElectricShots(shotContainerRef, route.path, route.totalLength, config.strokeWidth, config.electricShots);

    const viaPads = config.showViaPads ? getViaPadPositions(route.waypoints) : [];
    const opacity = config.opacity ?? 1;
    const viaColor = config.viaPadColor ?? '#888888';

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
          style={{ pointerEvents: 'visibleStroke', ...(config.pathStyle ?? {}) }}
          data-testid={`edge-${id}`}
        />

        {/* Electric shot container — shots managed imperatively by useElectricShots hook */}
        {config.electricShots && (
          <g ref={shotContainerRef} />
        )}

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
              stroke={viaColor}
              strokeWidth={VIA_PAD_STROKE}
              opacity={opacity * 0.5}
            />
            <circle
              cx={pt.x}
              cy={pt.y}
              r={VIA_PAD_R_INNER}
              fill={viaColor}
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
              stroke={viaColor}
              strokeWidth={VIA_PAD_STROKE + 0.5}
              opacity={opacity * 0.5}
            />
            <circle
              cx={sourceX}
              cy={sourceY}
              r={VIA_PAD_R_INNER + 1}
              fill={viaColor}
              opacity={opacity * 0.4}
            />
            <circle
              cx={targetX}
              cy={targetY}
              r={VIA_PAD_R_OUTER + 1}
              fill="none"
              stroke={viaColor}
              strokeWidth={VIA_PAD_STROKE + 0.5}
              opacity={opacity * 0.5}
            />
            <circle
              cx={targetX}
              cy={targetY}
              r={VIA_PAD_R_INNER + 1}
              fill={viaColor}
              opacity={opacity * 0.4}
            />
          </>
        )}
      </g>
    );
  },
);
PcbTraceEdge.displayName = 'PcbTraceEdge';
