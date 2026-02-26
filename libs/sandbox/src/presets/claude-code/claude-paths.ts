/**
 * Claude Code Binary Path Resolution
 *
 * Candidate directories where the Claude Code binary may be installed.
 * The official installer has moved from `.claude/local/bin` to `.local/bin`
 * (standard XDG location). We search both to support old and new installs.
 */

export const CLAUDE_BIN_CANDIDATE_DIRS = ['.local/bin', '.claude/local/bin'] as const;

export function buildClaudeSearchPath(agentHome: string): string {
  return CLAUDE_BIN_CANDIDATE_DIRS.map(d => `${agentHome}/${d}`).join(':');
}
