/**
 * Claude Code Pipeline
 *
 * Defines the ordered step array for Claude Code installation.
 */

import type { InstallStep } from '../types.js';
import {
  createStopHostProcessesStep,
  createCopyHostConfigStep,
} from '../shared/index.js';
import { installClaudeCodeStep } from './install-claude-code.js';
import { verifyClaudeBinaryStep } from './verify-claude-binary.js';

export function getClaudeCodePipeline(): InstallStep[] {
  return [
    installClaudeCodeStep,                                    // curl|bash
    verifyClaudeBinaryStep,                                   // claude --version
    createStopHostProcessesStep('claude', '[c]laude'),        // kill host procs
    createCopyHostConfigStep({                                // skip if freshInstall
      appName: 'claude',
      hostDir: (ctx) => `/Users/${ctx.hostUsername}/.claude`,
      agentDir: (ctx) => `${ctx.agentHome}/.claude`,
      excludeDirs: ['local', 'downloads'],
      postCopy: (ctx) => [
        `  find "${ctx.agentHome}/.claude" -name "*.json" -exec sed -i '' 's|/Users/${ctx.hostUsername}|${ctx.agentHome}|g' {} + 2>/dev/null || true`,
      ],
    }),
  ];
}
