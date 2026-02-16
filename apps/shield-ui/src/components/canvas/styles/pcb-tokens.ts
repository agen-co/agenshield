/**
 * PCB motherboard design tokens used by all canvas components.
 * Realistic PCB palette: black bodies, silver/gray pins, white silkscreen, green board.
 */

export const pcb = {
  board: {
    base: '#0A0A0A',         // near-black
    solderMask: '#121212',   // dark gray
    traceFaint: '#1A1A1A',   // faint trace gray
  },
  trace: {
    silver: '#A0A0A0',      // silver trace
    bright: '#C0C0C0',      // bright silver
    dimmed: '#555555',       // dimmed trace
  },
  via: {
    ring: '#888888',         // via pad ring
    fill: '#666666',         // via pad center
  },
  silk: {
    primary: '#FFFFFF',      // white silkscreen
    dim: '#999999',          // gray dim text
  },
  signal: {
    cyan: '#00E5FF',         // allowed pulse
    denied: '#FF1744',       // denied pulse
  },
  component: {
    body: '#111111',         // black chip body
    bodyLight: '#1A1A1A',    // slightly lighter black
    pin: '#999999',          // gray/silver pins
    pinBright: '#BBBBBB',    // bright active pins
    padGold: '#D4A04A',      // solder pad gold tip
    ledGreen: '#00FF41',
    ledRed: '#FF073A',
    ledAmber: '#FFD700',
    ledOff: '#333333',
  },
  light: {
    base: '#E0E0E0',         // light mode gray board
    silk: '#1A1A1A',         // dark text on light
    body: '#E8E8E0',         // light chip body
  },
} as const;
