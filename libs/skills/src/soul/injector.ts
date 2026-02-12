/**
 * Soul Injector
 *
 * Injects security-focused content into system prompts.
 */

import { DefaultSoulContent, getSoulContent } from './templates.js';

/** Soul injection configuration */
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

/** Injection context for soul */
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

export class SoulInjector {
  private config: SoulConfig;
  private content: string;

  constructor(config: Partial<SoulConfig> = {}) {
    this.config = {
      enabled: config.enabled ?? true,
      mode: config.mode || 'prepend',
      content: config.content,
      securityLevel: config.securityLevel || 'medium',
    };

    this.content = this.config.content || getSoulContent(this.config.securityLevel!);
  }

  /**
   * Inject soul content into a prompt
   */
  inject(originalPrompt: string, context?: InjectionContext): string {
    if (!this.config.enabled) {
      return originalPrompt;
    }

    const soulContent = this.buildSoulContent(context);

    switch (this.config.mode) {
      case 'prepend':
        return soulContent + '\n\n' + originalPrompt;

      case 'append':
        return originalPrompt + '\n\n' + soulContent;

      case 'replace':
        return soulContent;

      default:
        return originalPrompt;
    }
  }

  /**
   * Build soul content with context variables
   */
  private buildSoulContent(context?: InjectionContext): string {
    let content = this.content;

    if (context) {
      // Replace template variables
      if (context.workspacePath) {
        content = content.replace(/\{\{WORKSPACE\}\}/g, context.workspacePath);
      }

      if (context.allowedOperations) {
        content = content.replace(
          /\{\{ALLOWED_OPERATIONS\}\}/g,
          context.allowedOperations.join(', ')
        );
      }

      if (context.variables) {
        for (const [key, value] of Object.entries(context.variables)) {
          content = content.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value);
        }
      }
    }

    return content;
  }

  /**
   * Get the current soul content
   */
  getContent(): string {
    return this.content;
  }

  /**
   * Set custom soul content
   */
  setContent(content: string): void {
    this.content = content;
  }

  /**
   * Get the default soul content
   */
  getDefaultContent(): string {
    return DefaultSoulContent;
  }

  /**
   * Enable soul injection
   */
  enable(): void {
    this.config.enabled = true;
  }

  /**
   * Disable soul injection
   */
  disable(): void {
    this.config.enabled = false;
  }

  /**
   * Check if soul injection is enabled
   */
  isEnabled(): boolean {
    return this.config.enabled;
  }

  /**
   * Set injection mode
   */
  setMode(mode: SoulConfig['mode']): void {
    this.config.mode = mode;
  }

  /**
   * Set security level
   */
  setSecurityLevel(level: 'low' | 'medium' | 'high'): void {
    this.config.securityLevel = level;
    if (!this.config.content) {
      this.content = getSoulContent(level);
    }
  }
}
