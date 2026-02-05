/**
 * Custom ReactFlow edge types for the security architecture graph
 */

import { memo } from 'react';
import { BaseEdge, getSmoothStepPath, getStraightPath, type EdgeProps } from '@xyflow/react';
import { dashFlow, blockedFlash } from '../../../styles/setup-animations';

/** Pick only the props BaseEdge actually needs (avoids DOM attribute warnings) */
function baseEdgeProps(props: EdgeProps) {
  return {
    id: props.id,
    markerStart: props.markerStart,
    markerEnd: props.markerEnd,
    interactionWidth: props.interactionWidth,
  };
}

// --- Vulnerable edge: red dashed with animated particles ---

export const VulnerableEdge = memo((props: EdgeProps) => {
  const { sourceX, sourceY, targetX, targetY, data } = props;
  const [edgePath] = getStraightPath({ sourceX, sourceY, targetX, targetY });
  const delay = (data?.delay as number) ?? 0;
  const dur = (data?.dur as number) ?? 1.4;

  return (
    <>
      <BaseEdge
        {...baseEdgeProps(props)}
        path={edgePath}
        style={{
          stroke: '#ef4444',
          strokeWidth: 2,
          strokeDasharray: '6 4',
          animation: `${dashFlow} 1s linear infinite`,
        }}
      />
      {/* Attack particle dot — staggered to create cascade flow */}
      <circle r="3" fill="#ef4444" filter="url(#glow-red)">
        <animateMotion dur={`${dur}s`} begin={`${delay}s`} repeatCount="indefinite" path={edgePath} />
      </circle>
    </>
  );
});
VulnerableEdge.displayName = 'VulnerableEdge';

// --- Building edge: blue dashed with pulse ---

export const BuildingEdge = memo((props: EdgeProps) => {
  const { sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition } = props;
  const [edgePath] = getSmoothStepPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition });

  return (
    <BaseEdge
      {...baseEdgeProps(props)}
      path={edgePath}
      style={{
        stroke: '#3b82f6',
        strokeWidth: 2,
        strokeDasharray: '8 4',
        animation: `${dashFlow} 1.5s linear infinite`,
        opacity: 0.7,
      }}
    />
  );
});
BuildingEdge.displayName = 'BuildingEdge';

// --- Secured edge: solid green with gentle glow ---

export const SecuredEdge = memo((props: EdgeProps) => {
  const { sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition } = props;
  const [edgePath] = getSmoothStepPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition });

  return (
    <BaseEdge
      {...baseEdgeProps(props)}
      path={edgePath}
      style={{
        stroke: '#22c55e',
        strokeWidth: 2,
        filter: 'drop-shadow(0 0 3px rgba(34, 197, 94, 0.4))',
      }}
    />
  );
});
SecuredEdge.displayName = 'SecuredEdge';

// --- Blocked edge: subtle grey dashed line (no label — attack nodes already show BLOCKED) ---

export const BlockedEdge = memo((props: EdgeProps) => {
  const { sourceX, sourceY, targetX, targetY } = props;
  const [edgePath] = getStraightPath({ sourceX, sourceY, targetX, targetY });

  return (
    <BaseEdge
      {...baseEdgeProps(props)}
      path={edgePath}
      style={{
        stroke: '#6b7280',
        strokeWidth: 1,
        strokeDasharray: '4 4',
        opacity: 0.3,
        animation: `${blockedFlash} 0.6s ease-out forwards`,
      }}
    />
  );
});
BlockedEdge.displayName = 'BlockedEdge';

// --- Edge type registry ---

export const edgeTypes = {
  vulnerable: VulnerableEdge,
  building: BuildingEdge,
  secured: SecuredEdge,
  blocked: BlockedEdge,
};

// --- SVG filter definitions (add to graph container) ---

export function EdgeFilters() {
  return (
    <svg style={{ position: 'absolute', width: 0, height: 0 }}>
      <defs>
        <filter id="glow-red" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="2" result="blur" />
          <feFlood floodColor="#ef4444" floodOpacity="0.6" result="color" />
          <feComposite in="color" in2="blur" operator="in" />
          <feMerge>
            <feMergeNode />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <filter id="glow-green" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="2" result="blur" />
          <feFlood floodColor="#22c55e" floodOpacity="0.4" result="color" />
          <feComposite in="color" in2="blur" operator="in" />
          <feMerge>
            <feMergeNode />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
    </svg>
  );
}
