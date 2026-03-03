/**
 * Copy Claude Config Step
 *
 * Selectively copies host Claude Code config to agent home by category.
 * Only copies what's needed (~8.5 MB) instead of the entire ~/.claude (~4.8 GB).
 *
 * Categories:
 *   - settings: settings.json (always forced)
 *   - plugins:  plugins/ directory
 *   - memory:   projects/{name}/memory/ subdirs only (skips 3.9 GB session logs)
 *   - statsig:  statsig/ directory
 *   - plans:    plans/ directory
 *
 * Dynamically injected by detectHostClaudeStep when host config is found.
 */

import { DEFAULT_CLAUDE_CONFIG_CATEGORIES } from '../types.js';
import type { ClaudeConfigCategory, InstallStep } from '../types.js';

/** Build the shell script for a single category */
function categorySnippet(cat: ClaudeConfigCategory, src: string, dst: string): string {
  switch (cat) {
    case 'settings':
      return [
        `if [ -f "${src}/settings.json" ]; then`,
        `  cp "${src}/settings.json" "${dst}/settings.json"`,
        '  echo "COPIED_SETTINGS"',
        'fi',
      ].join('\n');

    case 'plugins':
      return [
        `if [ -d "${src}/plugins" ]; then`,
        `  rsync -a "${src}/plugins/" "${dst}/plugins/"`,
        '  echo "COPIED_PLUGINS"',
        'fi',
      ].join('\n');

    case 'memory':
      // Only copy projects/*/memory/ subtrees — skips massive .jsonl session logs
      return [
        `if [ -d "${src}/projects" ]; then`,
        `  find "${src}/projects" -path "*/memory" -type d | while read memdir; do`,
        `    relpath="\${memdir#${src}/}"`,
        `    mkdir -p "${dst}/\${relpath}"`,
        `    cp -a "\${memdir}/." "${dst}/\${relpath}/"`,
        '  done',
        '  echo "COPIED_MEMORY"',
        'fi',
      ].join('\n');

    case 'statsig':
      return [
        `if [ -d "${src}/statsig" ]; then`,
        `  rsync -a "${src}/statsig/" "${dst}/statsig/"`,
        '  echo "COPIED_STATSIG"',
        'fi',
      ].join('\n');

    case 'plans':
      return [
        `if [ -d "${src}/plans" ]; then`,
        `  rsync -a "${src}/plans/" "${dst}/plans/"`,
        '  echo "COPIED_PLANS"',
        'fi',
      ].join('\n');

    case 'credentials':
      // Credentials are handled by the separate copyClaudeCredentialsStep
      // (reads from macOS Keychain, not from files).
      return '# credentials: handled by copy_claude_credentials step';
  }
}

export const copyClaudeConfigStep: InstallStep = {
  id: 'copy_claude_config',
  name: 'Copy host Claude config',
  description: 'Selectively copy host .claude config to agent home',
  phase: 9,
  progressMessage: 'Copying host Claude Code configuration...',
  runsAs: 'root',
  timeout: 30_000,
  weight: 5,

  async run(ctx) {
    const hostConfigDir = `/Users/${ctx.hostUsername}/.claude`;
    const agentConfigDir = `${ctx.agentHome}/.claude`;

    // Resolve categories — always include 'settings', fall back to defaults
    const requested = (ctx.configCopyCategories as ClaudeConfigCategory[] | undefined) ?? DEFAULT_CLAUDE_CONFIG_CATEGORIES;
    const categories = new Set<ClaudeConfigCategory>(requested);
    categories.add('settings'); // always forced

    const snippets = Array.from(categories).map(cat =>
      categorySnippet(cat, hostConfigDir, agentConfigDir),
    );

    const script = [
      `if [ -d "${hostConfigDir}" ]; then`,
      `  mkdir -p "${agentConfigDir}"`,
      `  mkdir -p "${agentConfigDir}/skills"`,
      '',
      ...snippets.map(s => s.split('\n').map(line => `  ${line}`).join('\n')),
      '',
      `  chown -R ${ctx.agentUsername}:${ctx.socketGroupName} "${agentConfigDir}"`,
      '  echo "CONFIG_COPIED"',
      'else',
      `  mkdir -p "${agentConfigDir}/skills"`,
      `  chown -R ${ctx.agentUsername}:${ctx.socketGroupName} "${agentConfigDir}"`,
      '  echo "NO_HOST_CONFIG"',
      'fi',
    ].join('\n');

    const copyResult = await ctx.execAsRoot(script, { timeout: 30_000 });

    if (copyResult.output?.includes('NO_HOST_CONFIG')) {
      return {
        changed: false,
        warnings: ['No host Claude config found — agent will use defaults'],
      };
    }

    // Log which categories were actually copied
    const copied: string[] = [];
    for (const cat of categories) {
      if (copyResult.output?.includes(`COPIED_${cat.toUpperCase()}`)) {
        copied.push(cat);
      }
    }
    if (copied.length > 0) {
      ctx.onLog?.(`Copied Claude config categories: ${copied.join(', ')}`);
    }

    return { changed: true };
  },
};
