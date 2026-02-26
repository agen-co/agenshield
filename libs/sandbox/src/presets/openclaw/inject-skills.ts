/**
 * Inject Skills Step
 *
 * Copies AgenCo skill into the agent's OpenClaw workspace/skills directory.
 * The skill source is looked up at the host's .agenshield/skills/agenco or
 * the global /opt/agenshield/skills/agenco fallback.
 *
 * Gracefully warns if no skill source is found — the daemon deploys it later.
 */

import type { InstallStep } from '../types.js';

export const injectSkillsStep: InstallStep = {
  id: 'inject_skills',
  name: 'Inject AgenCo skill',
  description: 'Copy AgenCo skill into agent workspace/skills directory',
  phase: 10,
  progressMessage: 'Injecting AgenShield skills...',
  runsAs: 'root',
  timeout: 30_000,
  weight: 3,

  async run(ctx) {
    const skillsDir = `${ctx.agentHome}/.openclaw/workspace/skills`;
    const hostSkillPath = `${ctx.hostHome}/.agenshield/skills/agenco`;
    const globalSkillPath = '/opt/agenshield/skills/agenco';

    const result = await ctx.execAsRoot([
      // Ensure target directory exists
      `mkdir -p "${skillsDir}"`,
      `chown -R ${ctx.agentUsername}:${ctx.socketGroupName} "${skillsDir}"`,
      '',
      // Find skill source and copy (idempotent: rm + cp -a)
      `if [ -d "${hostSkillPath}/." ]; then`,
      `  SKILL_SRC="${hostSkillPath}"`,
      `elif [ -d "${globalSkillPath}/." ]; then`,
      `  SKILL_SRC="${globalSkillPath}"`,
      'else',
      '  SKILL_SRC=""',
      'fi',
      '',
      'if [ -n "$SKILL_SRC" ]; then',
      `  rm -rf "${skillsDir}/agenco"`,
      `  cp -a "$SKILL_SRC" "${skillsDir}/agenco"`,
      `  chown -R ${ctx.agentUsername}:${ctx.socketGroupName} "${skillsDir}/agenco"`,
      '  echo "SKILL_INJECTED"',
      'else',
      '  echo "NO_SKILL_SOURCE"',
      'fi',
    ].join('\n'), { timeout: 30_000 });

    if (result.output?.includes('NO_SKILL_SOURCE')) {
      return {
        changed: false,
        warnings: ['AgenCo skill not found on host — daemon will deploy it when integrations are connected'],
      };
    }

    return { changed: true };
  },
};
