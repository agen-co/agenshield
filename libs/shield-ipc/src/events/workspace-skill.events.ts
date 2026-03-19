/**
 * Workspace skill governance events.
 */

import { registerEventTypes } from './event-registry';

export interface WorkspaceSkillDetectedPayload {
  workspacePath: string;
  skillName: string;
  status: string;
}

export interface WorkspaceSkillApprovedPayload {
  workspacePath: string;
  skillName: string;
  approvedBy: string;
}

export interface WorkspaceSkillDeniedPayload {
  workspacePath: string;
  skillName: string;
}

export interface WorkspaceSkillRemovedPayload {
  workspacePath: string;
  skillName: string;
}

export interface WorkspaceSkillTamperedPayload {
  workspacePath: string;
  skillName: string;
  previousHash: string;
  currentHash: string;
}

export interface WorkspaceSkillRevokedPayload {
  workspacePath: string;
  skillName: string;
  previousApprovedBy: string;
}

export interface WorkspaceSkillCloudForcedPayload {
  skillName: string;
  targetWorkspaces: string[];
}

declare module '@agenshield/ipc' {
  interface EventRegistry {
    'workspace_skills:detected': WorkspaceSkillDetectedPayload;
    'workspace_skills:approved': WorkspaceSkillApprovedPayload;
    'workspace_skills:denied': WorkspaceSkillDeniedPayload;
    'workspace_skills:removed': WorkspaceSkillRemovedPayload;
    'workspace_skills:tampered': WorkspaceSkillTamperedPayload;
    'workspace_skills:revoked': WorkspaceSkillRevokedPayload;
    'workspace_skills:cloud_forced': WorkspaceSkillCloudForcedPayload;
  }
}

export const WORKSPACE_SKILL_EVENT_TYPES = [
  'workspace_skills:detected',
  'workspace_skills:approved',
  'workspace_skills:denied',
  'workspace_skills:removed',
  'workspace_skills:tampered',
  'workspace_skills:revoked',
  'workspace_skills:cloud_forced',
] as const;

registerEventTypes(WORKSPACE_SKILL_EVENT_TYPES);
