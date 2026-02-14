/**
 * CSS keyframe animations for the canvas dashboard
 */

import { keyframes } from '@emotion/react';

// --- Core status pulse animations ---

export const coreHealthyPulse = keyframes`
  0%, 100% {
    box-shadow: 0 0 0 0 rgba(108, 182, 133, 0.4);
  }
  50% {
    box-shadow: 0 0 20px 4px rgba(108, 182, 133, 0.2);
  }
`;

export const coreWarningPulse = keyframes`
  0%, 100% {
    box-shadow: 0 0 0 0 rgba(238, 164, 95, 0.4);
  }
  50% {
    box-shadow: 0 0 20px 4px rgba(238, 164, 95, 0.25);
  }
`;

export const coreErrorPulse = keyframes`
  0%, 100% {
    box-shadow: 0 0 0 0 rgba(225, 88, 62, 0.4);
  }
  50% {
    box-shadow: 0 0 20px 4px rgba(225, 88, 62, 0.3);
  }
`;

// --- SSE event ripple on target nodes ---

export const eventRipple = keyframes`
  0% {
    box-shadow: 0 0 0 0 rgba(108, 182, 133, 0.5);
  }
  70% {
    box-shadow: 0 0 0 12px rgba(108, 182, 133, 0);
  }
  100% {
    box-shadow: 0 0 0 0 rgba(108, 182, 133, 0);
  }
`;

export const eventRippleError = keyframes`
  0% {
    box-shadow: 0 0 0 0 rgba(225, 88, 62, 0.5);
  }
  70% {
    box-shadow: 0 0 0 12px rgba(225, 88, 62, 0);
  }
  100% {
    box-shadow: 0 0 0 0 rgba(225, 88, 62, 0);
  }
`;

export const eventRippleWarning = keyframes`
  0% {
    box-shadow: 0 0 0 0 rgba(238, 164, 95, 0.5);
  }
  70% {
    box-shadow: 0 0 0 12px rgba(238, 164, 95, 0);
  }
  100% {
    box-shadow: 0 0 0 0 rgba(238, 164, 95, 0);
  }
`;

// --- Edge particle flow ---

export const particleFlow = keyframes`
  0% { offset-distance: 0%; opacity: 0; }
  10% { opacity: 1; }
  90% { opacity: 1; }
  100% { offset-distance: 100%; opacity: 0; }
`;

// --- Activity slide-in ---

export const activitySlideIn = keyframes`
  from { opacity: 0; transform: translateX(8px); }
  to { opacity: 1; transform: translateX(0); }
`;

// --- Live dot blink ---

export const liveDot = keyframes`
  0%, 100% { opacity: 1; }
  50% { opacity: 0.3; }
`;

// --- Dash flow for edges ---

export const canvasDashFlow = keyframes`
  0% { stroke-dashoffset: 24; }
  100% { stroke-dashoffset: 0; }
`;
