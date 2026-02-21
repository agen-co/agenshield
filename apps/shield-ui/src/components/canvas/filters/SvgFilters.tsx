/**
 * SVG filter definitions for glow effects used by canvas nodes and edges
 */

export function SvgFilters() {
  return (
    <svg style={{ position: 'absolute', width: 0, height: 0, overflow: 'hidden', pointerEvents: 'none' }}>
      <defs>
        {/* Edge/wire animation keyframes (component keyframes moved to anime.js) */}
        <style>{`
          @keyframes danger-wire-pulse {
            0%, 100% { opacity: 0.5; }
            50% { opacity: 0.85; }
          }
          @keyframes danger-card-pulse {
            0%, 100% { opacity: 0.15; }
            50% { opacity: 0.45; }
          }
          @keyframes shield-trace-pulse {
            0%, 100% { opacity: 0.5; }
            50% { opacity: 0.75; }
          }
          @keyframes shield-logo-breathe {
            0%, 100% { opacity: 0.12; }
            50% { opacity: 0.3; }
          }
          @keyframes shield-breathe {
            0%, 100% { transform: scale(1); opacity: 0.95; }
            50% { transform: scale(1.012); opacity: 1; }
          }
          @keyframes pcb-led-pulse {
            0%, 100% { opacity: 0.7; }
            50% { opacity: 1; }
          }
          @keyframes pcb-led-glow-breathe {
            0%, 100% { opacity: 0.1; }
            50% { opacity: 0.25; }
          }
          @keyframes pcb-led-blink {
            0%, 49% { opacity: 1; }
            50%, 100% { opacity: 0.3; }
          }
          @keyframes shielded-card-pulse {
            0%, 100% { opacity: 0.2; stroke-width: 0.8; }
            50% { opacity: 0.6; stroke-width: 1.2; }
          }
        `}</style>
        {/* Green glow — healthy/shielded */}
        <filter id="canvas-glow-green" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="3" result="blur" />
          <feFlood floodColor="#6CB685" floodOpacity="0.4" result="color" />
          <feComposite in="color" in2="blur" operator="in" />
          <feMerge>
            <feMergeNode />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>

        {/* Red glow — error/unshielded */}
        <filter id="canvas-glow-red" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="3" result="blur" />
          <feFlood floodColor="#E1583E" floodOpacity="0.5" result="color" />
          <feComposite in="color" in2="blur" operator="in" />
          <feMerge>
            <feMergeNode />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>

        {/* Amber glow — warning */}
        <filter id="canvas-glow-amber" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="3" result="blur" />
          <feFlood floodColor="#EEA45F" floodOpacity="0.4" result="color" />
          <feComposite in="color" in2="blur" operator="in" />
          <feMerge>
            <feMergeNode />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>

        {/* Blue glow — info/cloud */}
        <filter id="canvas-glow-blue" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="3" result="blur" />
          <feFlood floodColor="#6BAEF2" floodOpacity="0.4" result="color" />
          <feComposite in="color" in2="blur" operator="in" />
          <feMerge>
            <feMergeNode />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>

        {/* PCB silver glow */}
        <filter id="pcb-glow-copper" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="2" result="blur" />
          <feFlood floodColor="#A0A0A0" floodOpacity="0.5" result="color" />
          <feComposite in="color" in2="blur" operator="in" />
          <feMerge>
            <feMergeNode />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>

        {/* PCB signal glow — cyan electric pulse */}
        <filter id="pcb-glow-signal" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="4" result="blur" />
          <feFlood floodColor="#00E5FF" floodOpacity="0.7" result="color" />
          <feComposite in="color" in2="blur" operator="in" />
          <feMerge>
            <feMergeNode />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>

        {/* PCB denied glow — red fault */}
        <filter id="pcb-glow-denied" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="4" result="blur" />
          <feFlood floodColor="#FF1744" floodOpacity="0.7" result="color" />
          <feComposite in="color" in2="blur" operator="in" />
          <feMerge>
            <feMergeNode />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>

        {/* Shield trace glow — dark green glow for shield connections */}
        <filter id="shield-trace-glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="3" result="blur" />
          <feFlood floodColor="#2D6B3F" floodOpacity="0.5" result="color" />
          <feComposite in="color" in2="blur" operator="in" />
          <feMerge>
            <feMergeNode />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>

        {/* Danger wire glow — thick red glow for danger wires */}
        <filter id="danger-wire-glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="3" result="blur" />
          <feFlood floodColor="#E1583E" floodOpacity="0.6" result="color" />
          <feComposite in="color" in2="blur" operator="in" />
          <feMerge>
            <feMergeNode />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>

        {/* Chip body gradient */}
        <linearGradient id="pcb-chip-gradient" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="rgba(255,255,255,0.05)" />
          <stop offset="100%" stopColor="rgba(0,0,0,0.1)" />
        </linearGradient>
      </defs>
    </svg>
  );
}
