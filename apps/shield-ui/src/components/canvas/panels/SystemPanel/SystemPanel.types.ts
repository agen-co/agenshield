/**
 * SystemPanel types
 */

export type SystemPanelMode = 'status' | 'setup' | 'passcode';

export interface SystemPanelProps {
  /** Whether the panel is visible */
  open: boolean;
  /** Callback when shielding completes */
  onShieldComplete?: () => void;
}
