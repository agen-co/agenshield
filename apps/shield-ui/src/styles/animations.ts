/**
 * CSS keyframe animations
 */

import { keyframes } from '@emotion/react';

// --- Loaders ---

export const spin = keyframes`
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
`;

export const idlePulse = keyframes`
  0%, 100% { opacity: 0.3; transform: scale(1); }
  50% { opacity: 0.8; transform: scale(1.2); }
`;

export const dotAnimation = keyframes`
  0% { content: ""; }
  33% { content: "."; }
  66% { content: ".."; }
  100% { content: "..."; }
`;

export const opacityAnimation = keyframes`
  0% { opacity: 0.5; }
  50% { opacity: 1; }
  100% { opacity: 0.5; }
`;

// --- Transitions ---

export const pulse = keyframes`
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
`;

export const slideIn = keyframes`
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
`;

export const fadeIn = keyframes`
  from { opacity: 0; }
  to { opacity: 1; }
`;

export const scaleIn = keyframes`
  from { opacity: 0; transform: scale(0.95); }
  to { opacity: 1; transform: scale(1); }
`;

export const float = keyframes`
  0%, 100% { transform: translate(0, 0) rotate(0deg); }
  25% { transform: translate(10px, -10px) rotate(5deg); }
  50% { transform: translate(-5px, 15px) rotate(-3deg); }
  75% { transform: translate(-15px, -5px) rotate(2deg); }
`;

export const glow = keyframes`
  0%, 100% { filter: brightness(1); }
  50% { filter: brightness(1.2); }
`;

export const rotate = keyframes`
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
`;

// --- Status ---

export const breathe = keyframes`
  0%, 100% { opacity: 0.3; }
  50% { opacity: 0.6; }
`;

export const peaceGlow = keyframes`
  0%, 100% { opacity: 0.5; }
  50% { opacity: 0.85; }
`;

export const alertPulse = keyframes`
  0%, 100% { opacity: 0.5; }
  50% { opacity: 0.9; }
`;

export const alertWave = keyframes`
  0% {
    box-shadow:
      0 0 0 0 rgba(225, 88, 62, 0.4),
      0 0 0 0 rgba(225, 88, 62, 0.3),
      0 0 0 0 rgba(225, 88, 62, 0.2);
    opacity: 0.8;
  }
  50% {
    box-shadow:
      0 0 0 10px rgba(225, 88, 62, 0.2),
      0 0 0 20px rgba(225, 88, 62, 0.1),
      0 0 0 30px rgba(225, 88, 62, 0.05);
    opacity: 1;
  }
  100% {
    box-shadow:
      0 0 0 20px rgba(225, 88, 62, 0),
      0 0 0 40px rgba(225, 88, 62, 0),
      0 0 0 60px rgba(225, 88, 62, 0);
    opacity: 0.6;
  }
`;

export const executingPulse = keyframes`
  0%, 100% { opacity: 0.4; }
  50% { opacity: 0.7; }
`;
