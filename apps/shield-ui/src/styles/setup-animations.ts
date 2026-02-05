/**
 * CSS keyframe animations for the setup wizard
 *
 * Attack vector animations, build progress, and security state transitions.
 * Uses @emotion/react keyframes (consistent with existing animations.ts).
 */

import { keyframes } from '@emotion/react';

// --- Attack animations ---

/** Red dot traveling along a vulnerable edge path */
export const attackParticle = keyframes`
  0% { transform: translateX(0%); opacity: 0; }
  10% { opacity: 1; }
  90% { opacity: 1; }
  100% { transform: translateX(100%); opacity: 0; }
`;

/** Red glow pulse on vulnerable edges */
export const attackPulse = keyframes`
  0%, 100% {
    filter: drop-shadow(0 0 2px rgba(239, 68, 68, 0.4));
  }
  50% {
    filter: drop-shadow(0 0 8px rgba(239, 68, 68, 0.8));
  }
`;

// --- Building animations ---

/** Blue shimmer on nodes being constructed */
export const buildingPulse = keyframes`
  0%, 100% {
    box-shadow: 0 0 0 0 rgba(59, 130, 246, 0.3);
    border-color: rgba(59, 130, 246, 0.5);
  }
  50% {
    box-shadow: 0 0 12px 4px rgba(59, 130, 246, 0.2);
    border-color: rgba(59, 130, 246, 1);
  }
`;

/** Blue dashed edge animation */
export const dashFlow = keyframes`
  0% { stroke-dashoffset: 24; }
  100% { stroke-dashoffset: 0; }
`;

// --- Secured animations ---

/** Green aura on completed/secured nodes */
export const securedGlow = keyframes`
  0%, 100% {
    box-shadow: 0 0 4px 1px rgba(34, 197, 94, 0.2);
  }
  50% {
    box-shadow: 0 0 12px 4px rgba(34, 197, 94, 0.3);
  }
`;

/** Final secured state — gentle green pulse on entire graph */
export const securedGraphGlow = keyframes`
  0%, 100% { opacity: 0.7; }
  50% { opacity: 1; }
`;

// --- Transition animations ---

/** Red→grey flash when an attack gets blocked */
export const blockedFlash = keyframes`
  0% { stroke: #ef4444; opacity: 1; }
  30% { stroke: #fbbf24; opacity: 0.9; }
  100% { stroke: #6b7280; opacity: 0.5; }
`;

/** Scale bounce for new nodes appearing */
export const nodeAppear = keyframes`
  0% { transform: scale(0); opacity: 0; }
  60% { transform: scale(1.1); opacity: 1; }
  80% { transform: scale(0.95); }
  100% { transform: scale(1); opacity: 1; }
`;

/** Fade + slide for node labels */
export const labelAppear = keyframes`
  0% { opacity: 0; transform: translateY(4px); }
  100% { opacity: 1; transform: translateY(0); }
`;

// --- Utility ---

/** Slow rotation for loading/processing indicators */
export const slowSpin = keyframes`
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
`;

/** Shield icon pulse on the seatbelt node */
export const shieldPulse = keyframes`
  0%, 100% { transform: scale(1); filter: brightness(1); }
  50% { transform: scale(1.05); filter: brightness(1.2); }
`;
