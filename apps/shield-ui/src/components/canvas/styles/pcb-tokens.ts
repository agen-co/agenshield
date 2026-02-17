/**
 * PCB motherboard design tokens used by all canvas components.
 * Realistic PCB palette: black bodies, silver/gray pins, white silkscreen, green board.
 */

export const pcb = {
  board: {
    base: '#181A1E',         // dark charcoal
    solderMask: '#1E2024',   // dark grey solder mask
    traceFaint: '#2A2C30',   // visible faint traces
  },
  trace: {
    silver: '#8A8A90',      // slightly cooler silver
    bright: '#B0B0B8',      // cooler bright silver
    dimmed: '#555555',       // dimmed trace
  },
  via: {
    ring: '#888888',         // via pad ring
    fill: '#666666',         // via pad center
  },
  silk: {
    primary: '#8A8E92',      // muted grey silkscreen
    dim: '#585C60',          // dimmer secondary text
  },
  signal: {
    cyan: '#00E5FF',         // allowed pulse
    denied: '#FF1744',       // denied pulse
  },
  component: {
    body: '#1C1C20',         // chip body dark grey
    bodyLight: '#242428',    // lighter variant
    pin: '#999999',          // gray/silver pins
    pinBright: '#BBBBBB',    // bright active pins
    padGold: '#D4A04A',      // solder pad gold tip
    ledGreen: '#3DC75F',
    ledRed: '#D43F3F',
    ledAmber: '#E8B84A',
    ledOff: '#333333',
  },
  light: {
    base: '#EAEAE6',         // neutral warm grey
    silk: '#1A1A1A',         // dark text on light
    body: '#E0E0DA',         // neutral light chip body
    trace: '#B0B0A8',        // light traces
    silkDim: '#6A6A6A',      // neutral grey
  },
} as const;
