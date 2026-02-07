import { memo, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Typography,
  Switch,
  IconButton,
  Box,
  Chip,
  Divider,
  Button,
  Collapse,
} from '@mui/material';
import { Pencil, Trash2, Package, Plus, CircleCheck, ChevronDown } from 'lucide-react';
import type { PolicyConfig } from '@agenshield/ipc';
import type { SkillSummary } from '../../../api/client';
import { StatusBadge } from '../../shared/StatusBadge';
import { PolicyRow, PolicyName, PolicyMeta } from '../PolicyList/PolicyList.styles';

const ACTION_VARIANT: Record<string, 'success' | 'error' | 'warning'> = {
  allow: 'success',
  deny: 'error',
  approval: 'warning',
};

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-');
}

interface CommandPolicyListProps {
  policies: PolicyConfig[];
  skills: SkillSummary[];
  onToggle: (id: string, enabled: boolean) => void;
  onEdit: (policy: PolicyConfig) => void;
  onDelete: (id: string) => void;
  onAddSkillPolicy: (skillSlug: string, skillName: string, commandName: string) => void;
  readOnly?: boolean;
  busy?: boolean;
}

/** Extract the base command name from a pattern like "git:*" → "git" */
function baseCommand(pattern: string): string {
  const idx = pattern.indexOf(':');
  return idx >= 0 ? pattern.slice(0, idx) : pattern;
}

/* ── Skill command group types ───────────────────────────── */

interface SkillCommandGroup {
  name: string;
  slug: string;
  commands: Array<{ name: string; source: string; available: boolean; required: boolean }>;
}

/* ── Skill command row ───────────────────────────────────── */

interface SkillCommandRowProps {
  commandName: string;
  skillName: string;
  skillSlug: string;
  hasLinkedPolicy: boolean;
  linkedAction: 'allow' | 'deny' | null;
  onAddPolicy: (skillSlug: string, skillName: string, commandName: string) => void;
  busy?: boolean;
}

const SkillCommandRow = memo(function SkillCommandRow({
  commandName,
  skillName,
  skillSlug,
  hasLinkedPolicy,
  linkedAction,
  onAddPolicy,
  busy,
}: SkillCommandRowProps) {
  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 2,
        px: 2,
        py: 1.25,
        borderBottom: 1,
        borderColor: 'divider',
        '&:last-child': { borderBottom: 'none' },
      }}
    >
      <Chip
        size="small"
        label={commandName}
        variant="outlined"
        sx={{ fontFamily: '"IBM Plex Mono", monospace', fontSize: 12, height: 24 }}
      />

      {hasLinkedPolicy && linkedAction ? (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
          <CircleCheck size={14} color="var(--mui-palette-success-main)" />
          <StatusBadge
            label={linkedAction}
            variant={ACTION_VARIANT[linkedAction] ?? 'success'}
            dot={false}
            size="small"
          />
        </Box>
      ) : (
        <Button
          size="small"
          variant="outlined"
          startIcon={<Plus size={12} />}
          onClick={() => onAddPolicy(skillSlug, skillName, commandName)}
          disabled={busy}
          sx={{ fontSize: 11, height: 26, textTransform: 'none' }}
        >
          Add Policy
        </Button>
      )}

      <Box sx={{ flex: 1 }} />

      <Typography
        component={Link}
        to={`/skills/${skillSlug}`}
        variant="caption"
        color="text.secondary"
        noWrap
        sx={{
          fontFamily: '"IBM Plex Mono", monospace',
          fontSize: 11,
          textDecoration: 'none',
          flexShrink: 0,
          '&:hover': { textDecoration: 'underline' },
        }}
      >
        {skillName}
      </Typography>
    </Box>
  );
}, (prev, next) =>
  prev.commandName === next.commandName &&
  prev.skillSlug === next.skillSlug &&
  prev.hasLinkedPolicy === next.hasLinkedPolicy &&
  prev.linkedAction === next.linkedAction &&
  prev.busy === next.busy &&
  prev.onAddPolicy === next.onAddPolicy,
);

/* ── Command policy row ──────────────────────────────────── */

interface CommandRowProps {
  policy: PolicyConfig;
  relatedSkills: string;
  onToggle: (id: string, enabled: boolean) => void;
  onEdit: (policy: PolicyConfig) => void;
  onDelete: (id: string) => void;
  busy?: boolean;
}

const CommandRow = memo(function CommandRow({
  policy,
  relatedSkills,
  onToggle,
  onEdit,
  onDelete,
  busy,
}: CommandRowProps) {
  return (
    <PolicyRow onClick={() => onEdit(policy)}>
      <Box onClick={(e) => e.stopPropagation()} sx={{ flexShrink: 0 }}>
        <Switch
          checked={policy.enabled}
          onChange={(e) => onToggle(policy.id, e.target.checked)}
          disabled={busy}
        />
      </Box>

      <PolicyName>
        <Typography variant="body2" fontWeight={500} noWrap>
          {policy.name}
        </Typography>
      </PolicyName>

      <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
        {policy.patterns.slice(0, 8).map((p) => (
          <Chip
            key={p}
            size="small"
            label={p}
            variant="outlined"
            sx={{ fontFamily: '"IBM Plex Mono", monospace', fontSize: 11, height: 20 }}
          />
        ))}
        {policy.patterns.length > 8 && (
          <Chip
            size="small"
            label={`+${policy.patterns.length - 8}`}
            variant="outlined"
            sx={{ fontSize: 11, height: 20 }}
          />
        )}
      </Box>

      <PolicyMeta>
        <StatusBadge
          label={policy.action}
          variant={ACTION_VARIANT[policy.action] ?? 'success'}
          dot={false}
          size="small"
        />
        {policy.preset && (
          <Chip
            size="small"
            label={policy.preset === 'openclaw' ? 'OpenClaw' : policy.preset}
            color="info"
            variant="outlined"
            sx={{ fontSize: 10, height: 18 }}
          />
        )}
      </PolicyMeta>

      {relatedSkills && (
        <Typography
          variant="caption"
          color="text.secondary"
          noWrap
          sx={{
            fontFamily: '"IBM Plex Mono", monospace',
            fontSize: 11,
            maxWidth: 200,
            flexShrink: 0,
          }}
        >
          Used by: {relatedSkills}
        </Typography>
      )}

      <Box sx={{ display: 'flex', gap: 0.5, flexShrink: 0 }}>
        <IconButton
          size="small"
          onClick={(e) => { e.stopPropagation(); onEdit(policy); }}
        >
          <Pencil size={14} />
        </IconButton>
        <IconButton
          size="small"
          color="error"
          onClick={(e) => { e.stopPropagation(); onDelete(policy.id); }}
          disabled={busy}
        >
          <Trash2 size={14} />
        </IconButton>
      </Box>
    </PolicyRow>
  );
}, (prev, next) => {
  if (prev.busy !== next.busy) return false;
  if (prev.onToggle !== next.onToggle || prev.onEdit !== next.onEdit || prev.onDelete !== next.onDelete) return false;
  if (prev.relatedSkills !== next.relatedSkills) return false;
  const a = prev.policy, b = next.policy;
  return a.id === b.id && a.enabled === b.enabled && a.name === b.name &&
    a.action === b.action && a.preset === b.preset &&
    a.patterns.length === b.patterns.length &&
    a.patterns.every((p, i) => p === b.patterns[i]);
});

/* ── List component ───────────────────────────────────────── */

export function CommandPolicyList({
  policies,
  skills,
  onToggle,
  onEdit,
  onDelete,
  onAddSkillPolicy,
  readOnly,
  busy,
}: CommandPolicyListProps) {
  // Build skill command groups from installed skills
  const skillCommandGroups = useMemo<SkillCommandGroup[]>(() => {
    const groups: SkillCommandGroup[] = [];
    for (const skill of skills) {
      if (skill.status !== 'active') continue;
      const analysis = (skill as any).analysis;
      const commands = analysis?.commands;
      if (!commands?.length) continue;
      groups.push({
        name: skill.name,
        slug: slugify(skill.name),
        commands: commands.map((c: any) => ({
          name: c.name,
          source: c.source ?? 'metadata',
          available: c.available,
          required: c.required ?? false,
        })),
      });
    }
    return groups;
  }, [skills]);

  // Build linked policy lookup: "skill:<slug>:<baseCmd>" → action
  const linkedPolicyMap = useMemo(() => {
    const map = new Map<string, 'allow' | 'deny'>();
    for (const p of policies) {
      if (!p.preset?.startsWith('skill:')) continue;
      for (const pattern of p.patterns) {
        map.set(`${p.preset}:${baseCommand(pattern)}`, p.action as 'allow' | 'deny');
      }
    }
    return map;
  }, [policies]);

  // Build reverse map: command name → skill names (for "Used by" labels)
  const skillCommandMap = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const skill of skills) {
      const analysis = (skill as any).analysis;
      if (analysis?.commands) {
        for (const cmd of analysis.commands) {
          const list = map.get(cmd.name) ?? [];
          if (!list.includes(skill.name)) list.push(skill.name);
          map.set(cmd.name, list);
        }
      }
    }
    return map;
  }, [skills]);

  // Pre-compute related skills text per policy (for non-skill-linked policies)
  const relatedSkillsMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const policy of policies) {
      if (policy.preset?.startsWith('skill:')) continue;
      const seen = new Set<string>();
      for (const pattern of policy.patterns) {
        const cmd = baseCommand(pattern);
        const names = skillCommandMap.get(cmd);
        if (names) names.forEach((n) => seen.add(n));
      }
      map.set(policy.id, Array.from(seen).join(', '));
    }
    return map;
  }, [policies, skillCommandMap]);

  const hasSkillGroups = skillCommandGroups.length > 0;
  const hasPolicies = policies.length > 0;

  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

  const toggleGroup = (slug: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });
  };

  return (
    <Box>
      {/* All command policy rows */}
      {policies.map((policy) => (
        <CommandRow
          key={policy.id}
          policy={policy}
          relatedSkills={relatedSkillsMap.get(policy.id) ?? ''}
          onToggle={onToggle}
          onEdit={onEdit}
          onDelete={onDelete}
          busy={busy}
        />
      ))}

      {/* Separator between policies and skill groups */}
      {hasSkillGroups && hasPolicies && <Divider />}

      {/* Skill-driven command groups */}
      {skillCommandGroups.map((group) => {
        const isExpanded = !collapsedGroups.has(group.slug);
        return (
          <Box key={group.slug}>
            {/* Section header */}
            <Box
              onClick={() => toggleGroup(group.slug)}
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 1,
                px: 2,
                py: 1.25,
                bgcolor: 'action.hover',
                borderBottom: 1,
                borderColor: 'divider',
                cursor: 'pointer',
                userSelect: 'none',
              }}
            >
              <Package size={14} />
              <Typography
                component={Link}
                to={`/skills/${group.slug}`}
                variant="subtitle2"
                onClick={(e) => e.stopPropagation()}
                sx={{
                  textDecoration: 'none',
                  color: 'text.primary',
                  '&:hover': { textDecoration: 'underline' },
                }}
              >
                {group.name}
              </Typography>
              <Box sx={{ flex: 1 }} />
              <ChevronDown
                size={16}
                style={{
                  transition: 'transform 0.2s ease',
                  transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
                }}
              />
            </Box>

            {/* Command rows */}
            <Collapse in={isExpanded}>
              {group.commands.map((cmd) => {
                const key = `skill:${group.slug}:${baseCommand(cmd.name)}`;
                const action = linkedPolicyMap.get(key) ?? null;
                return (
                  <SkillCommandRow
                    key={`${group.slug}-${cmd.name}`}
                    commandName={cmd.name}
                    skillName={group.name}
                    skillSlug={group.slug}
                    hasLinkedPolicy={action !== null}
                    linkedAction={action}
                    onAddPolicy={onAddSkillPolicy}
                    busy={busy}
                  />
                );
              })}
            </Collapse>
          </Box>
        );
      })}
    </Box>
  );
}
