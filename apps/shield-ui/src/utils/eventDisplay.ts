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
  'config:policies_updated': { icon: ShieldAlert, label: 'Policies Updated', color: 'info' },

  // Exec
  'exec:monitored': { icon: Terminal, label: 'Exec Monitored', color: 'info' },
  'exec:denied': { icon: Terminal, label: 'Exec Denied', color: 'error' },

  // Skills
  'skills:quarantined': { icon: Zap, label: 'Skill Quarantined', color: 'warning' },
  'skills:approved': { icon: Zap, label: 'Skills Scanner', color: 'success' },
  'skills:installed': { icon: Zap, label: 'Skill Installed', color: 'success' },
  'skills:install_failed': { icon: Zap, label: 'Skill Install Failed', color: 'error' },
  'skills:install_started': { icon: Download, label: 'Skill Installing', color: 'info' },
  'skills:install_progress': { icon: Download, label: 'Skill Install Progress', color: 'info' },
  'skills:untrusted_detected': { icon: AlertTriangle, label: 'Untrusted Skill Detected', color: 'warning' },
  'skills:uninstalled': { icon: Trash2, label: 'Skill Uninstalled', color: 'warning' },
  'skills:analyzed': { icon: Search, label: 'Skill Analyzed', color: 'success' },
  'skills:analysis_failed': { icon: Zap, label: 'Skill Analysis Failed', color: 'error' },
  'skills:integrity_violation': { icon: AlertTriangle, label: 'Integrity Violation', color: 'error' },
  'skills:integrity_restored': { icon: RefreshCw, label: 'Skill Restored', color: 'success' },

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
  'process:broker_started': { icon: Play, label: 'Broker Started', color: 'success' },
  'process:broker_stopped': { icon: Square, label: 'Broker Stopped', color: 'warning' },
  'process:broker_restarted': { icon: RefreshCw, label: 'Broker Restarted', color: 'info' },
  'process:gateway_started': { icon: Play, label: 'Gateway Started', color: 'success' },
  'process:gateway_stopped': { icon: Square, label: 'Gateway Stopped', color: 'warning' },
  'process:gateway_restarted': { icon: RefreshCw, label: 'Gateway Restarted', color: 'info' },
  'process:daemon_started': { icon: Play, label: 'Daemon Started', color: 'success' },
  'process:daemon_stopped': { icon: Square, label: 'Daemon Stopped', color: 'warning' },

  // Daemon
  'daemon:status': { icon: RefreshCw, label: 'Daemon Heartbeat', color: 'secondary' },

  // Interceptor
  'interceptor:event': { icon: Crosshair, label: 'Interceptor Event', color: 'info' },

  // Setup
  'setup:shield_progress': { icon: ShieldAlert, label: 'Shield Progress', color: 'info' },
  'setup:shield_steps': { icon: ShieldAlert, label: 'Shield Steps', color: 'info' },
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
  'skills:integrity_violation',
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

/* ------------------------------------------------------------------ */
/*  Event Severity                                                      */
/* ------------------------------------------------------------------ */

export type EventSeverity = 'error' | 'warn' | 'info' | 'debug' | 'verbose';

export const SEVERITY_COLORS: Record<EventSeverity, string> = {
  error: '#E1583E',
  warn: '#EEA45F',
  info: '#6BAEF2',
  debug: '#9E9E9E',
  verbose: '#BDBDBD',
};

/** Derive a severity level from the event type and payload */
export function getEventSeverity(event: SSEEvent): EventSeverity {
  const t = event.type;

  // Error: blocked / denied / threat events
  if (BLOCKED_EVENT_TYPES.has(t)) return 'error';
  if (t === 'exec:denied') return 'error';
  if (t === 'security:critical' || t === 'security:alert') return 'error';
  if (t === 'agenco:error') return 'error';
  if (t === 'skills:install_failed' || t === 'skills:analysis_failed') return 'error';
  if (t === 'interceptor:event') {
    const d = event.data as Record<string, unknown>;
    const dtype = String(d.type ?? '');
    if (dtype === 'denied' || dtype === 'deny') return 'error';
    // Allowed interceptor events are info
    if (dtype === 'allowed' || dtype === 'allow') return 'info';
  }

  // Warn: security warnings, alerts, resource limits, broker crashes
  if (t === 'security:status' || t === 'security:warning') return 'warn';
  if (t.startsWith('alerts:')) return 'warn';
  if (t === 'resource:limit_exceeded') return 'warn';
  if (t === 'process:broker_crashed') return 'warn';
  if (t === 'skills:quarantined' || t === 'skills:untrusted_detected' || t === 'skills:integrity_violation') return 'warn';

  // Info: meaningful operational events
  if (t === 'skills:installed' || t === 'skills:uninstalled') return 'info';
  if (t === 'skills:analyzed' || t === 'skills:integrity_restored') return 'info';
  if (t === 'config:changed' || t === 'config:policies_updated') return 'info';
  if (t.startsWith('setup:')) return 'info';
  if (t.endsWith('_started') || t.endsWith('_stopped') || t === 'process:started' || t === 'process:stopped') return 'info';
  if (t === 'agenco:connected' || t === 'agenco:disconnected' || t === 'agenco:auth_completed') return 'info';
  if (t.startsWith('wrappers:')) return 'debug';

  // Debug: low-level operational
  if (t === 'api:request' || t === 'api:outbound') return 'debug';
  if (t.startsWith('broker:')) return 'debug';
  if (t.startsWith('agenco:')) return 'debug';

  // Verbose: heartbeats, noise
  if (t === 'daemon:status') return 'verbose';
  if (t === 'skills:approved') return 'verbose';
  if (isNoiseEvent(event)) return 'verbose';

  return 'debug';
}

/* ------------------------------------------------------------------ */
/*  Noise filter                                                        */
/* ------------------------------------------------------------------ */

/** Noisy allowed exec commands to always filter in the overview feed (matched by prefix) */
const NOISE_COMMANDS = ['arp ', 'networksetup ', 'ifconfig ', 'scutil '];

/** API polling paths that are just the UI refreshing data */
const NOISE_API_PATHS = ['/api/metrics', '/api/security', '/api/health', '/api/status', '/api/alerts', '/api/targets'];

/** Returns true for low-value system probe events (allowed exec of arp, networksetup, etc.) */
export function isNoiseEvent(event: SSEEvent): boolean {
  // Hide low-signal system events
  if (event.type === 'skills:approved') return true;
  if (event.type === 'daemon:status') return true;
  if (event.type === 'metrics:eventloop') return true;

  // Hide API polling requests (GET to known polling endpoints)
  if (event.type === 'api:request') {
    const d = event.data as Record<string, unknown>;
    const method = String(d.method ?? '').toUpperCase();
    const path = String(d.path ?? '');
    if (method === 'GET' && NOISE_API_PATHS.some((p) => path.startsWith(p))) return true;
  }

  if (event.type !== 'interceptor:event') return false;
  const d = event.data as Record<string, unknown>;
  if (d.operation !== 'exec') return false;
  if (d.type !== 'allowed' && d.type !== 'allow' && d.type !== 'intercept') return false;
  const target = String(d.target ?? '');
  return NOISE_COMMANDS.some((prefix) => target.startsWith(prefix));
}

/** Single source-of-truth summary string for an event */
export function getEventSummary(event: SSEEvent): string {
  const d = event.data as Record<string, unknown>;

  if (event.type === 'api:request') {
    const method = String(d.method ?? 'GET').toUpperCase();
    const path = String(d.path ?? '');
    return `${method} ${path}`;
  }
  if (event.type === 'api:outbound') {
    const method = String(d.method ?? 'GET').toUpperCase();
    const url = String(d.url ?? '');
    try {
      const parsed = new URL(url);
      return `${method} ${parsed.pathname}`;
    } catch {
      return `${method} ${url}`;
    }
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
  if (event.type === 'skills:integrity_violation') {
    const name = String(d.slug ?? d.name ?? '');
    const action = String(d.action ?? '');
    const modified = Array.isArray(d.modifiedFiles) ? (d.modifiedFiles as string[]).length : 0;
    const missing = Array.isArray(d.missingFiles) ? (d.missingFiles as string[]).length : 0;
    const total = modified + missing;
    const suffix = total > 0 ? ` (${total} file${total !== 1 ? 's' : ''})` : '';
    return action ? `${name} — ${action}${suffix}` : name;
  }
  if (event.type === 'skills:integrity_restored') {
    const name = String(d.slug ?? d.name ?? '');
    return `${name} — files restored`;
  }

  if (event.type === 'config:policies_updated') {
    const source = String(d.source ?? 'cloud');
    const count = Number(d.count ?? 0);
    return `${count} ${count === 1 ? 'policy' : 'policies'} from ${source}`;
  }
  if (event.type === 'setup:shield_progress' || event.type === 'setup:shield_steps') {
    const targetId = String(d.targetId ?? '');
    const step = String(d.step ?? d.message ?? '');
    return step ? `${targetId}: ${step}` : `Shielding ${targetId}`;
  }

  if (event.type.startsWith('process:')) {
    const process = String(d.process ?? '').replace(/^\w/, (c) => c.toUpperCase());
    const action = String(d.action ?? '');
    const pid = d.pid;
    const base = process && action ? `${process} ${action}` : process || action || event.type;
    return pid ? `${base} (PID ${pid})` : base;
  }

  return (d.message as string) ??
    (d.url as string) ??
    (d.method as string) ??
    (d.name as string) ??
    (d.integration as string) ??
    JSON.stringify(d).slice(0, 120);
}

/**
 * Replace raw targetId references in a summary string with human-readable profile names.
 */
export function resolveTargetNames(
  summary: string,
  targetNameMap: Map<string, string>,
): string {
  if (targetNameMap.size === 0) return summary;
  let result = summary;
  for (const [id, name] of targetNameMap) {
    if (result.includes(id)) {
      result = result.replaceAll(id, name);
    }
  }
  return result;
}

/** Semantic color key for an event — 'error' for deny, 'success' for allow, else the display default */
export function getEventColor(event: SSEEvent): string {
  if (event.type === 'api:request' || event.type === 'api:outbound') {
    const d = event.data as Record<string, unknown>;
    const code = Number(d.statusCode ?? 0);
    if (code >= 200 && code < 300) return 'success';
    if (code >= 400) return 'error';
    return 'info';
  }
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
  if (event.type === 'api:request' || event.type === 'api:outbound') {
    const d = event.data as Record<string, unknown>;
    const code = Number(d.statusCode ?? 0);
    if (code >= 200 && code < 300) return { label: String(code), variant: 'success' };
    if (code >= 400) return { label: String(code), variant: 'error' };
    if (code >= 300) return { label: String(code), variant: 'warning' };
    return { label: code ? String(code) : 'pending', variant: 'info' };
  }
  if (event.type === 'interceptor:event') {
    const d = event.data as Record<string, unknown>;
    const dtype = String(d.type ?? '');
    if (dtype === 'denied' || dtype === 'deny') return { label: 'deny', variant: 'error' };
    if (dtype === 'allowed' || dtype === 'allow') return { label: 'allow', variant: 'success' };
    return { label: dtype || 'event', variant: 'info' };
  }
  if (BLOCKED_EVENT_TYPES.has(event.type)) return { label: 'deny', variant: 'error' };
  if (event.type.startsWith('process:')) {
    if (event.type.endsWith('_started')) return { label: 'started', variant: 'success' };
    if (event.type.endsWith('_stopped')) return { label: 'stopped', variant: 'warning' };
    if (event.type.endsWith('_restarted')) return { label: 'restarted', variant: 'info' };
    if (event.type === 'process:started') return { label: 'started', variant: 'success' };
    if (event.type === 'process:stopped') return { label: 'stopped', variant: 'warning' };
  }
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
