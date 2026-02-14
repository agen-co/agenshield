/**
 * Alert rules — which events auto-generate alerts
 *
 * Each rule maps an event type to alert severity, title, and description template.
 * Template placeholders use {field} syntax interpolated from event data.
 */

import type { AlertSeverity } from './alert.types';

export interface AlertRule {
  severity: AlertSeverity;
  title: string;
  descriptionTemplate: string;
}

export const ALERT_RULES: Record<string, AlertRule> = {
  'security:critical': {
    severity: 'critical',
    title: 'Critical Security Issue',
    descriptionTemplate: '{message}',
  },
  'security:alert': {
    severity: 'critical',
    title: 'Security Alert',
    descriptionTemplate: '{message}',
  },
  'security:config_tampered': {
    severity: 'critical',
    title: 'Configuration Tampered',
    descriptionTemplate: 'Configuration tampering detected at {detectedAt}. Action: {action}.',
  },
  'security:warning': {
    severity: 'warning',
    title: 'Security Warning',
    descriptionTemplate: '{message}',
  },
  'skills:quarantined': {
    severity: 'warning',
    title: 'Skill Quarantined',
    descriptionTemplate: 'Skill "{name}" was quarantined: {reason}.',
  },
  'skills:untrusted_detected': {
    severity: 'warning',
    title: 'Untrusted Skill Detected',
    descriptionTemplate: 'Untrusted skill "{name}" detected: {reason}.',
  },
  'skills:integrity_violation': {
    severity: 'critical',
    title: 'Skill Integrity Violation',
    descriptionTemplate: 'Skill "{name}" ({slug}) has been modified. Action: {action}.',
  },
  'skills:install_failed': {
    severity: 'warning',
    title: 'Skill Installation Failed',
    descriptionTemplate: 'Failed to install skill "{name}": {error}.',
  },
  'skills:analysis_failed': {
    severity: 'info',
    title: 'Skill Analysis Failed',
    descriptionTemplate: 'Analysis failed for skill "{name}": {error}.',
  },
  'skills:deploy_failed': {
    severity: 'warning',
    title: 'Skill Deploy Failed',
    descriptionTemplate: 'Failed to deploy skill "{name}": {error}.',
  },
  'exec:denied': {
    severity: 'warning',
    title: 'Command Denied',
    descriptionTemplate: 'Command "{command}" was denied: {reason}.',
  },
};

/**
 * Check if an event type should generate an alert.
 */
export function isAlertWorthy(eventType: string): boolean {
  return eventType in ALERT_RULES;
}

/**
 * Interpolate a description template with event data fields.
 * Replaces {field} placeholders with values from data.
 */
export function interpolateTemplate(template: string, data: unknown): string {
  if (!data || typeof data !== 'object') return template;
  const record = data as Record<string, unknown>;
  return template.replace(/\{(\w+)\}/g, (_match, field: string) => {
    const value = record[field];
    if (value === undefined || value === null) return `{${field}}`;
    return String(value);
  });
}
