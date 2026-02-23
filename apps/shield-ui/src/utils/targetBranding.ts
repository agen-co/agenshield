/**
 * Shared brand constants for target applications.
 *
 * Extracted from ApplicationCardNode and BrokerNode to keep icon/logo
 * lookup consistent across canvas nodes, overlays, and sidebar.
 */

import { Terminal, Globe, Monitor, Cpu } from 'lucide-react';

/** Brand SVG icons served from /icons/ (keyed by target type) */
export const BRAND_ICONS: Record<string, string> = {
  openclaw: '/icons/openclaw.svg',
  'claude-code': '/icons/claude-code.svg',
};

/** Lucide icon component lookup (keyed by icon string) */
export const TARGET_ICON_MAP: Record<string, typeof Terminal> = {
  Terminal,
  Globe,
  Monitor,
  Cpu,
};

/** Map target type to an icon string */
const TYPE_ICON_MAP: Record<string, string> = {
  claude: 'Terminal',
  'claude-code': 'Terminal',
  cursor: 'Monitor',
  windsurf: 'Globe',
  openclaw: 'Globe',
};

/** Get the brand SVG path for a target type, or null if none exists. */
export function getBrandIcon(type: string): string | null {
  return BRAND_ICONS[type] ?? null;
}

/** Get the lucide icon component for a target type. Falls back to Terminal. */
export function getTargetIcon(type: string): typeof Terminal {
  const iconName = TYPE_ICON_MAP[type] ?? 'Terminal';
  return TARGET_ICON_MAP[iconName] ?? Terminal;
}
