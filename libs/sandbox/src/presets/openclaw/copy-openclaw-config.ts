/**
 * Copy OpenClaw Config Step
 *
 * Selectively copies host OpenClaw config to agent home by category.
 * Replaces the previous blanket `rsync -a --delete` approach.
 *
 * Categories:
 *   - config:    openclaw.json
 *   - workspace: workspace/ directory
 *   - skills:    skills/ directory
 *   - plugins:   plugins/ directory
 *   - cache:     cache/ directory
 *
 * Dynamically injected by detectHostOpenclawStep when host config is found.
 */

import { DEFAULT_OPENCLAW_CONFIG_CATEGORIES } from '../types.js';
import type { OpenclawConfigCategory, InstallStep } from '../types.js';

/** Build the shell script for a single category */
function categorySnippet(cat: OpenclawConfigCategory, src: string, dst: string): string {
  switch (cat) {
    case 'config':
      return [
        `if [ -f "${src}/openclaw.json" ]; then`,
        `  cp "${src}/openclaw.json" "${dst}/openclaw.json"`,
        '  echo "COPIED_CONFIG"',
        'fi',
      ].join('\n');

    case 'workspace':
      return [
        `if [ -d "${src}/workspace" ]; then`,
        `  rsync -a "${src}/workspace/" "${dst}/workspace/"`,
        '  echo "COPIED_WORKSPACE"',
        'fi',
      ].join('\n');

    case 'skills':
      return [
        `if [ -d "${src}/skills" ]; then`,
        `  rsync -a "${src}/skills/" "${dst}/skills/"`,
        '  echo "COPIED_SKILLS"',
        'fi',
      ].join('\n');

    case 'plugins':
      return [
        `if [ -d "${src}/plugins" ]; then`,
        `  rsync -a "${src}/plugins/" "${dst}/plugins/"`,
        '  echo "COPIED_PLUGINS"',
        'fi',
      ].join('\n');

    case 'cache':
      return [
        `if [ -d "${src}/cache" ]; then`,
        `  rsync -a "${src}/cache/" "${dst}/cache/"`,
        '  echo "COPIED_CACHE"',
        'fi',
      ].join('\n');
  }
}

export const copyOpenclawConfigStep: InstallStep = {
  id: 'copy_config',
  name: 'Copy host OpenClaw config',
  description: 'Selectively copy host .openclaw config to agent home',
  phase: 9,
  progressMessage: 'Copying host OpenClaw configuration...',
  runsAs: 'root',
  timeout: 30_000,
  weight: 5,

  async run(ctx) {
    const hostConfigDir = `/Users/${ctx.hostUsername}/.openclaw`;
    const agentConfigDir = `${ctx.agentHome}/.openclaw`;

    // Resolve categories — fall back to defaults
    const requested = (ctx.configCopyCategories as OpenclawConfigCategory[] | undefined) ?? DEFAULT_OPENCLAW_CONFIG_CATEGORIES;
    const categories = new Set<OpenclawConfigCategory>(requested);

    const snippets = Array.from(categories).map(cat =>
      categorySnippet(cat, hostConfigDir, agentConfigDir),
    );

    const script = [
      `if [ -d "${hostConfigDir}" ]; then`,
      `  mkdir -p "${agentConfigDir}"`,
      '',
      ...snippets.map(s => s.split('\n').map(line => `  ${line}`).join('\n')),
      '',
      `  chown -R ${ctx.agentUsername}:${ctx.socketGroupName} "${agentConfigDir}"`,
      '  echo "CONFIG_COPIED"',
      'else',
      '  echo "NO_HOST_CONFIG"',
      'fi',
    ].join('\n');

    const copyResult = await ctx.execAsRoot(script, { timeout: 30_000 });

    if (copyResult.output?.includes('NO_HOST_CONFIG')) {
      return {
        changed: false,
        warnings: ['No host OpenClaw config found — agent will use defaults'],
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
      ctx.onLog?.(`Copied OpenClaw config categories: ${copied.join(', ')}`);
    }

    return { changed: true };
  },
};
