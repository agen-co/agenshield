/**
 * Marketplace types for skill browsing and installation
 */

export interface MarketplaceSkill {
  name: string;
  slug: string;
  description: string;
  author: string;
  version: string;
  installs: number;
  tags: string[];
  readme?: string;
  files?: MarketplaceSkillFile[];
}

export interface MarketplaceSkillFile {
  name: string;
  type: string;
  content: string;
  purpose?: string;
}

export interface AnalyzeSkillRequest {
  skillName: string;
  publisher: string;
  files: MarketplaceSkillFile[];
}

/* ------------------------------------------------------------------ */
/*  Deep analysis sub-types (optional, backward compatible)            */
/* ------------------------------------------------------------------ */

export type SkillSecuritySeverity = 'safe' | 'low' | 'medium' | 'high' | 'critical';

export interface EnvVariableDetail {
  name: string;
  required: boolean;
  purpose: string;
  sensitive: boolean;
}

export interface RuntimeRequirement {
  runtime: string;
  minVersion?: string;
  reason: string;
}

export interface InstallationStep {
  command: string;
  packageManager: string;
  required: boolean;
  description: string;
}

export interface RunCommand {
  command: string;
  description: string;
  entrypoint: boolean;
}

export interface SecurityFinding {
  severity: SkillSecuritySeverity;
  category: string;
  cwe?: string;
  owaspCategory?: string;
  description: string;
  evidence?: string;
}

export type MCPRiskType =
  | 'tool-poisoning'
  | 'memory-poisoning'
  | 'prompt-injection'
  | 'soul-override'
  | 'permission-escalation'
  | 'data-exfiltration'
  | 'hidden-instructions';

export interface MCPSpecificRisk {
  riskType: MCPRiskType;
  description: string;
  severity: SkillSecuritySeverity;
}

/* ------------------------------------------------------------------ */
/*  Response types                                                     */
/* ------------------------------------------------------------------ */

export interface AnalyzeSkillResponse {
  analysis: {
    status: 'complete' | 'error';
    vulnerability: {
      level: SkillSecuritySeverity;
      details: string[];
      suggestions?: string[];
    };
    commands: Array<{
      name: string;
      source: string;
      available: boolean;
      resolvedPath?: string;
      required: boolean;
    }>;
    envVariables?: EnvVariableDetail[];
    runtimeRequirements?: RuntimeRequirement[];
    installationSteps?: InstallationStep[];
    runCommands?: RunCommand[];
    securityFindings?: SecurityFinding[];
    mcpSpecificRisks?: MCPSpecificRisk[];
  };
}

export interface InstallSkillRequest {
  slug: string;
  files: MarketplaceSkillFile[];
  analysis: AnalyzeSkillResponse['analysis'];
  publisher?: string;
}
