/**
 * Shared event display metadata - single source of truth for icons, labels, and colors
 * across ActivityFeed, Activity page, and TrafficChart.
 */

import type { Palette } from '@mui/material/styles';
import {
  Globe,
  ArrowUpRight,
  ShieldAlert,
  ShieldBan,
  ArrowRightLeft,
  Settings as SettingsIcon,
  Terminal,
  Zap,
  Download,
  Package,
  RefreshCw,
  Link2,
  Play,
  Square,
  Crosshair,
  AlertTriangle,
  Search,
  Trash2,
} from 'lucide-react';

export interface EventDisplayMeta {
  icon: React.ComponentType<{ size?: number }>;
  label: string;
  /** Semantic color key resolved via resolveEventColor */
  color: string;
}

export const EVENT_DISPLAY: Record<string, EventDisplayMeta> = {
  // API
  'api:request': { icon: Globe, label: 'API Request', color: 'primary' },
  'api:outbound': { icon: ArrowUpRight, label: 'Outbound Request', color: 'info' },

  // Security
  'security:status': { icon: ShieldAlert, label: 'Security Status', color: 'warning' },
  'security:warning': { icon: ShieldAlert, label: 'Security Warning', color: 'warning' },
  'security:critical': { icon: ShieldBan, label: 'Security Critical', color: 'error' },
  'security:alert': { icon: ShieldBan, label: 'Security Alert', color: 'error' },

  // Broker
  'broker:request': { icon: ArrowRightLeft, label: 'Broker Request', color: 'info' },
  'broker:response': { icon: ArrowRightLeft, label: 'Broker Response', color: 'info' },

  // Config
  'config:changed': { icon: SettingsIcon, label: 'Config Changed', color: 'secondary' },

  // Exec
  'exec:monitored': { icon: Terminal, label: 'Exec Monitored', color: 'info' },
  'exec:denied': { icon: Terminal, label: 'Exec Denied', color: 'error' },

  // Skills
  'skills:quarantined': { icon: Zap, label: 'Skill Quarantined', color: 'warning' },
  'skills:approved': { icon: Zap, label: 'Skill Approved', color: 'success' },
  'skills:installed': { icon: Zap, label: 'Skill Installed', color: 'success' },
  'skills:install_failed': { icon: Zap, label: 'Skill Install Failed', color: 'error' },
  'skills:install_started': { icon: Download, label: 'Skill Installing', color: 'info' },
  'skills:install_progress': { icon: Download, label: 'Skill Install Progress', color: 'info' },
  'skills:untrusted_detected': { icon: AlertTriangle, label: 'Untrusted Skill Detected', color: 'warning' },
  'skills:uninstalled': { icon: Trash2, label: 'Skill Uninstalled', color: 'warning' },
  'skills:analyzed': { icon: Search, label: 'Skill Analyzed', color: 'success' },
  'skills:analysis_failed': { icon: Zap, label: 'Skill Analysis Failed', color: 'error' },

  // Wrappers
  'wrappers:installed': { icon: Package, label: 'Wrapper Installed', color: 'success' },
  'wrappers:uninstalled': { icon: Package, label: 'Wrapper Uninstalled', color: 'warning' },
  'wrappers:updated': { icon: Package, label: 'Wrapper Updated', color: 'info' },
  'wrappers:custom_added': { icon: Package, label: 'Custom Wrapper Added', color: 'success' },
  'wrappers:custom_removed': { icon: Package, label: 'Custom Wrapper Removed', color: 'warning' },
  'wrappers:synced': { icon: RefreshCw, label: 'Wrappers Synced', color: 'info' },
  'wrappers:regenerated': { icon: RefreshCw, label: 'Wrappers Regenerated', color: 'info' },

  // AgenCo
  'agenco:connected': { icon: Link2, label: 'AgenCo Connected', color: 'success' },
  'agenco:disconnected': { icon: Link2, label: 'AgenCo Disconnected', color: 'error' },
  'agenco:auth_required': { icon: Link2, label: 'Auth Required', color: 'warning' },
  'agenco:auth_completed': { icon: Link2, label: 'Auth Completed', color: 'success' },
  'agenco:tool_executed': { icon: Link2, label: 'Tool Executed', color: 'info' },
  'agenco:error': { icon: Link2, label: 'AgenCo Error', color: 'error' },

  // Process
  'process:started': { icon: Play, label: 'Process Started', color: 'success' },
  'process:stopped': { icon: Square, label: 'Process Stopped', color: 'warning' },

  // Interceptor
  'interceptor:event': { icon: Crosshair, label: 'Interceptor Event', color: 'info' },
};

const FALLBACK_DISPLAY: EventDisplayMeta = { icon: Globe, label: 'Unknown', color: 'primary' };

export function getEventDisplay(type: string): EventDisplayMeta {
  return EVENT_DISPLAY[type] ?? FALLBACK_DISPLAY;
}

/**
 * Event types that count as "blocked" in the TrafficChart.
 * `interceptor:event` needs separate data.type === 'denied' check.
 */
export const BLOCKED_EVENT_TYPES: ReadonlySet<string> = new Set([
  'exec:denied',
  'skills:quarantined',
  'skills:untrusted_detected',
  'security:warning',
  'security:critical',
  'security:alert',
]);

/** Resolve a semantic color key (e.g. 'error', 'info') to a palette color value */
export function resolveEventColor(color: string, palette: Palette): string {
  switch (color) {
    case 'error': return palette.error.main;
    case 'warning': return palette.warning.main;
    case 'success': return palette.success.main;
    case 'info': return palette.info.main;
    case 'secondary': return palette.text.secondary;
    default: return palette.primary.main;
  }
}

/* ------------------------------------------------------------------ */
/*  Shared summary / color / status helpers                            */
/* ------------------------------------------------------------------ */

import type { SSEEvent } from '../state/events';
import type { StatusVariant } from '../components/shared/StatusBadge/StatusBadge.types';

/** Single source-of-truth summary string for an event */
export function getEventSummary(event: SSEEvent): string {
  const d = event.data as Record<string, unknown>;

  if (event.type === 'api:outbound') {
    const ctx = d.context ?? '';
    const status = d.statusCode ?? '';
    const url = d.url ?? '';
    return `${ctx} [${status}] ${url}`;
  }
  if (event.type === 'exec:denied') {
    const command = d.command ?? d.target ?? '';
    const reason = d.reason ?? d.error ?? '';
    return reason ? `${command} — ${reason}` : String(command);
  }
  if (event.type === 'interceptor:event') {
    const operation = String(d.operation ?? '');
    const target = String(d.target ?? '');
    const dtype = String(d.type ?? '');
    const error = d.error as string | undefined;

    if (dtype === 'denied' || dtype === 'deny') {
      const hasTarget = (dtype === 'denied' || dtype === 'deny') &&
        (operation === 'http_request' || operation === 'exec') && target;
      const base = hasTarget ? `BLOCKED ${operation}: ${target}` : `BLOCKED ${operation}`;
      return error ? `${base} — ${error}` : base;
    }
    // allow + http_request/exec → show target
    if ((operation === 'http_request' || operation === 'exec') && target) {
      return `${operation}: ${target}`;
    }
    return operation;
  }
  if (event.type === 'skills:untrusted_detected') {
    const name = d.name ?? '';
    const reason = d.reason ?? '';
    return reason ? `${name} — ${reason}` : String(name);
  }
  if (event.type === 'skills:uninstalled') {
    return String(d.name ?? '');
  }

  return (d.message as string) ??
    (d.url as string) ??
    (d.method as string) ??
    (d.name as string) ??
    (d.integration as string) ??
    JSON.stringify(d).slice(0, 120);
}

/** Semantic color key for an event — 'error' for deny, 'success' for allow, else the display default */
export function getEventColor(event: SSEEvent): string {
  if (BLOCKED_EVENT_TYPES.has(event.type)) return 'error';
  if (event.type === 'interceptor:event') {
    const d = event.data as Record<string, unknown>;
    const dtype = String(d.type ?? '');
    if (dtype === 'denied' || dtype === 'deny') return 'error';
    if (dtype === 'allowed' || dtype === 'allow') return 'success';
  }
  return getEventDisplay(event.type).color;
}

/** Status badge data for the Activity table (matches policy StatusBadge style) */
export function getEventStatus(event: SSEEvent): { label: string; variant: StatusVariant } {
  if (event.type === 'interceptor:event') {
    const d = event.data as Record<string, unknown>;
    const dtype = String(d.type ?? '');
    if (dtype === 'denied' || dtype === 'deny') return { label: 'deny', variant: 'error' };
    if (dtype === 'allowed' || dtype === 'allow') return { label: 'allow', variant: 'success' };
    return { label: dtype || 'event', variant: 'info' };
  }
  if (BLOCKED_EVENT_TYPES.has(event.type)) return { label: 'deny', variant: 'error' };
  if (event.type.includes('installed') || event.type.includes('approved') || event.type.includes('connected') || event.type.includes('started')) {
    return { label: 'allow', variant: 'success' };
  }
  if (event.type.includes('warning') || event.type.includes('quarantined') || event.type.includes('untrusted')) {
    return { label: 'warning', variant: 'warning' };
  }
  if (event.type.includes('failed') || event.type.includes('error') || event.type.includes('critical') || event.type.includes('alert')) {
    return { label: 'error', variant: 'error' };
  }
  return { label: 'info', variant: 'info' };
}
