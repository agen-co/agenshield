/**
 * Skill lifecycle events.
 */

import { registerEventTypes } from './event-registry';

export interface SkillNamePayload {
  name: string;
}

export interface SkillNameReasonPayload {
  name: string;
  reason: string;
}

export interface SkillAnalyzedPayload {
  name: string;
  analysis: unknown;
}

export interface SkillInstallProgressPayload {
  name: string;
  step: string;
  message: string;
}

declare module '@agenshield/ipc' {
  interface EventRegistry {
    'skills:quarantined': SkillNameReasonPayload;
    'skills:untrusted_detected': SkillNameReasonPayload;
    'skills:approved': SkillNamePayload;
    'skills:analyzed': SkillAnalyzedPayload;
    'skills:analysis_failed': { name: string; error: string };
    'skills:install_started': SkillNamePayload;
    'skills:install_progress': SkillInstallProgressPayload;
    'skills:installed': SkillNamePayload;
    'skills:install_failed': { name: string; error: string };
    'skills:uninstalled': SkillNamePayload;
    'skills:deployed': { name: string; adapterId: string };
    'skills:deploy_failed': { name: string; error: string };
    'skills:integrity_violation': { name: string; slug: string; action: string; modifiedFiles: string[]; missingFiles: string[]; unexpectedFiles: string[] };
    'skills:integrity_restored': { name: string; slug: string; modifiedFiles: string[]; missingFiles: string[] };
  }
}

export const SKILL_EVENT_TYPES = [
  'skills:quarantined',
  'skills:untrusted_detected',
  'skills:approved',
  'skills:analyzed',
  'skills:analysis_failed',
  'skills:install_started',
  'skills:install_progress',
  'skills:installed',
  'skills:install_failed',
  'skills:uninstalled',
  'skills:deployed',
  'skills:deploy_failed',
  'skills:integrity_violation',
  'skills:integrity_restored',
] as const;

registerEventTypes(SKILL_EVENT_TYPES);
