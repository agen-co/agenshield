/**
 * Custom ReactFlow edge types for the security architecture graph
 */

import { memo } from 'react';
import { BaseEdge, getBezierPath, type EdgeProps } from '@xyflow/react';
import { dashFlow, blockedFlash } from '../../../styles/setup-animations';

// --- Vulnerable edge: red dashed with animated particles ---

export const VulnerableEdge = memo((props: EdgeProps) => {
  const { sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition } = props;
  const [edgePath] = getBezierPath({
    sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition,
  });

  return (
    <>
      <BaseEdge
        {...props}
        path={edgePath}
        style={{
          stroke: '#ef4444',
          strokeWidth: 2,
          strokeDasharray: '6 4',
          animation: `${dashFlow} 1s linear infinite`,
        }}
      />
      {/* Attack particle dot */}
      <circle r="3" fill="#ef4444" filter="url(#glow-red)">
        <animateMotion dur="2s" repeatCount="indefinite" path={edgePath} />
      </circle>
    </>
  );
});
VulnerableEdge.displayName = 'VulnerableEdge';

// --- Building edge: blue dashed with pulse ---

export const BuildingEdge = memo((props: EdgeProps) => {
  const { sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition } = props;
  const [edgePath] = getBezierPath({
    sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition,
  });

  return (
    <BaseEdge
      {...props}
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
  const { sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition } = props;
  const [edgePath] = getBezierPath({
    sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition,
  });

  return (
    <BaseEdge
      {...props}
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

// --- Blocked edge: red → grey with ✗ icon ---

const blockedLabelStyles: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 700,
  fill: '#6b7280',
  fontFamily: "'IBM Plex Mono', monospace",
};

export const BlockedEdge = memo((props: EdgeProps) => {
  const { sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition } = props;
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition,
  });

  return (
    <>
      <BaseEdge
        {...props}
        path={edgePath}
        style={{
          stroke: '#6b7280',
          strokeWidth: 1.5,
          strokeDasharray: '4 4',
          opacity: 0.5,
          animation: `${blockedFlash} 0.6s ease-out forwards`,
        }}
      />
      {/* Blocked indicator */}
      <g transform={`translate(${labelX}, ${labelY})`}>
        <rect x="-20" y="-10" width="40" height="20" rx="4" fill="rgba(17,24,39,0.8)" stroke="#6b7280" strokeWidth="1" />
        <text style={blockedLabelStyles} textAnchor="middle" dominantBaseline="central">
          BLOCKED
        </text>
      </g>
    </>
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
