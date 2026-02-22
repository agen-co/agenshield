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
    silver: '#A0A0A8',      // slightly cooler silver
    bright: '#C8C8D0',      // cooler bright silver
    dimmed: '#606060',       // dimmed trace
    hover: '#D0D0D8',       // hover-highlighted traces
  },
  via: {
    ring: '#888888',         // via pad ring
    fill: '#666666',         // via pad center
  },
  silk: {
    primary: '#A0A4A8',      // muted grey silkscreen
    dim: '#6E7276',          // dimmer secondary text
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
  accent: {
    cpu: '#3DC75F',       // green — matches ledGreen
    network: '#00E5FF',   // cyan
    disk: '#E8B84A',      // amber — matches ledAmber
    memory: '#8B5CF6',    // purple
  },
  light: {
    base: '#EAEAE6',         // neutral warm grey
    silk: '#1A1A1A',         // dark text on light
    body: '#E0E0DA',         // neutral light chip body
    trace: '#B0B0A8',        // light traces
    silkDim: '#6A6A6A',      // neutral grey
  },
} as const;
