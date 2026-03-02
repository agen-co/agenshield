/**
 * Claude Code Install Steps
 *
 * Claude Code-specific step objects and pipeline definition.
 */

export { getClaudeCodePipeline } from './pipeline.js';
export { installClaudeCodeStep } from './install-claude-code.js';
export { verifyClaudeBinaryStep } from './verify-claude-binary.js';
export { copyClaudeNodeBinStep } from './copy-claude-node-bin.js';
export { detectHostClaudeStep } from './detect-host-claude.js';
export { copyClaudeConfigStep } from './copy-claude-config.js';
export { rewriteClaudePathsStep } from './rewrite-claude-paths.js';
export { buildClaudeSearchPath, CLAUDE_BIN_CANDIDATE_DIRS } from './claude-paths.js';
