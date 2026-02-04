/**
 * Skills Types
 */

/**
 * Skill manifest from SKILL.md frontmatter
 */
export interface SkillManifest {
  name: string;
  description: string;
  userInvocable?: boolean;
  disableModelInvocation?: boolean;
  commandDispatch?: 'bash' | 'node' | 'python';
  commandTool?: string;
  commandArgMode?: 'single' | 'multi';
  requires?: SkillRequirements;
  agenshield?: AgenShieldConfig;
  always?: boolean;
  os?: string[];
  primaryEnv?: string;
  install?: string;
}

/**
 * Skill requirements
 */
export interface SkillRequirements {
  bins?: string[];
  anyBins?: string[];
  env?: string[];
  config?: string[];
}

/**
 * AgenShield-specific configuration
 */
export interface AgenShieldConfig {
  policy?: string;
  allowedCommands?: string[];
  requiredApproval?: boolean;
  auditLevel?: 'debug' | 'info' | 'warn' | 'error';
  securityLevel?: 'low' | 'medium' | 'high';
}

/**
 * Complete skill definition
 */
export interface Skill {
  /** Unique skill name */
  name: string;

  /** Human-readable description */
  description: string;

  /** Whether user can invoke directly */
  userInvocable: boolean;

  /** Whether model can invoke */
  disableModelInvocation: boolean;

  /** How to dispatch commands */
  commandDispatch: 'bash' | 'node' | 'python';

  /** Tool to use for commands */
  commandTool: string;

  /** How to handle arguments */
  commandArgMode: 'single' | 'multi';

  /** Skill requirements */
  requires: SkillRequirements;

  /** AgenShield config */
  agenshield: AgenShieldConfig;

  /** Markdown content (instructions) */
  content: string;

  /** Source path */
  sourcePath: string;
}

/**
 * Soul injection configuration
 */
export interface SoulConfig {
  /** Whether soul injection is enabled */
  enabled: boolean;

  /** Injection mode */
  mode: 'prepend' | 'append' | 'replace';

  /** Custom soul content (uses default if not provided) */
  content?: string;

  /** Security level */
  securityLevel?: 'low' | 'medium' | 'high';
}

/**
 * Skill execution options
 */
export interface ExecuteOptions {
  /** Command arguments */
  args?: string[];

  /** Execution context */
  context?: {
    userId?: string;
    workingDir?: string;
    environment?: Record<string, string>;
  };

  /** Timeout in milliseconds */
  timeout?: number;

  /** Whether to require approval */
  requireApproval?: boolean;
}

/**
 * Skill execution result
 */
export interface ExecuteResult {
  /** Whether execution succeeded */
  success: boolean;

  /** Exit code (if applicable) */
  exitCode?: number;

  /** Standard output */
  stdout?: string;

  /** Standard error */
  stderr?: string;

  /** Error message */
  error?: string;

  /** Execution duration in ms */
  duration: number;

  /** Policy that was applied */
  policyApplied?: string;
}

/**
 * Skill validation result
 */
export interface ValidationResult {
  /** Whether skill is valid */
  valid: boolean;

  /** Validation errors */
  errors: string[];

  /** Validation warnings */
  warnings: string[];
}

/**
 * Injection context for soul
 */
export interface InjectionContext {
  /** Current security level */
  securityLevel?: 'low' | 'medium' | 'high';

  /** Allowed operations */
  allowedOperations?: string[];

  /** Workspace path */
  workspacePath?: string;

  /** Custom variables */
  variables?: Record<string, string>;
}
