/**
 * useCanvasHealthSync — aggregates live API data into per-component
 * health counts and writes to systemStore via setComponentHealth.
 *
 * Runs at the Canvas level. Subscribes to:
 *   - Skills: active/quarantined/downloaded counts
 *   - Secrets: exposed secrets from security status
 *   - Policies: enabled/disabled policy counts
 *   - Monitoring: security warnings/critical issues + alert counts
 */

import { useEffect } from 'react';
import { useSkills, useSecrets, useSecurity, useConfig, useAlertsCount } from '../api/hooks';
import { setComponentHealth, type ComponentHealth } from '../state/system-store';

function deriveHealth(danger: number, warn: number): ComponentHealth {
  if (danger > 0) return 'danger';
  if (warn > 0) return 'warn';
  return 'ok';
}

export function useCanvasHealthSync(): void {
  const { data: skillsData } = useSkills();
  const { data: secretsData } = useSecrets();
  const { data: securityData } = useSecurity();
  const { data: configData } = useConfig();
  const { data: alertsCountData } = useAlertsCount();

  // --- Skills chip ---
  useEffect(() => {
    const skills = skillsData?.data;
    if (!skills) return;

    let ok = 0;
    let warn = 0;
    let danger = 0;
    for (const s of skills) {
      if (s.status === 'active' || s.status === 'workspace') ok++;
      else if (s.status === 'downloaded') warn++;
      else if (s.status === 'quarantined' || s.status === 'disabled') danger++;
    }

    setComponentHealth('skills', deriveHealth(danger, warn), { ok, warn, danger });
  }, [skillsData]);

  // --- Secrets chip ---
  useEffect(() => {
    const security = securityData?.data;
    const secrets = secretsData?.data;
    if (!security && !secrets) return;

    const exposedCount = security?.exposedSecrets?.length ?? 0;
    const totalSecrets = secrets?.length ?? 0;
    const ok = Math.max(0, totalSecrets - exposedCount);
    const danger = exposedCount;

    setComponentHealth('secrets', deriveHealth(danger, 0), { ok, warn: 0, danger });
  }, [securityData, secretsData]);

  // --- Policies chip ---
  useEffect(() => {
    const policies = configData?.data?.policies;
    if (!policies) return;

    let ok = 0;
    let warn = 0;
    const danger = policies.length === 0 ? 1 : 0;
    for (const p of policies) {
      if (p.enabled) ok++;
      else warn++;
    }

    const health = danger > 0 ? 'danger' as const : deriveHealth(0, warn);
    setComponentHealth('policy-graph', health, { ok, warn, danger });
  }, [configData]);

  // --- Monitoring chip ---
  useEffect(() => {
    const security = securityData?.data;
    const unackCount = alertsCountData?.data?.count ?? 0;

    const warnings = security?.warnings?.length ?? 0;
    const criticals = security?.critical?.length ?? 0;

    const danger = criticals + Math.min(unackCount, 1);
    const warn = warnings;
    const ok = danger === 0 && warn === 0 ? 1 : 0;

    setComponentHealth('monitoring', deriveHealth(danger, warn), { ok, warn, danger });
  }, [securityData, alertsCountData]);
}
