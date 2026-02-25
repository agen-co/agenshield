/**
 * Claude Code Pipeline
 *
 * Defines the ordered step array for Claude Code installation.
 * Single source of truth for execution order.
 */

import type { InstallStep } from '../types.js';
import {
  saveHostShellConfigStep,
  createRestoreShellConfigStep,
  createStopHostProcessesStep,
  createAppWrapperStep,
} from '../shared/index.js';
import { installClaudeCodeStep } from './install-claude-code.js';
import { verifyClaudeBinaryStep } from './verify-claude-binary.js';
import { detectHostClaudeStep } from './detect-host-claude.js';

export function getClaudeCodePipeline(): InstallStep[] {
  return [
    // Phase 6: Shell config protection
    saveHostShellConfigStep,                                    // weight 1

    // Phase 8: Target App
    installClaudeCodeStep,                                      // weight 30, check: version match?
    createRestoreShellConfigStep('claude'),                     // weight 1
    verifyClaudeBinaryStep,                                     // weight 5

    // Phase 9: Configuration
    createAppWrapperStep('claude', async (ctx) => {             // weight 2
      return `${ctx.agentHome}/.claude/local/bin/claude`;
    }),
    createStopHostProcessesStep('claude', '[c]laude'),          // weight 3
    detectHostClaudeStep,                                       // weight 2, resolve -> copy + rewrite
  ];
}
