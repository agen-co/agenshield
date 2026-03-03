/**
 * Shielding step — shows progress while a target is being shielded.
 *
 * When granular steps are available (setup:shield_steps SSE events),
 * renders a phase-grouped checklist with per-step logs.
 * Falls back to legacy flat progress bar + log list when steps[] is empty.
 */

import { useState, useEffect, useRef, useMemo } from 'react';
import {
  Shield,
  Loader,
  ChevronDown,
  ChevronUp,
  CheckCircle,
  AlertCircle,
  Circle,
  MinusCircle,
} from 'lucide-react';
import { SHIELD_PHASE_LABELS, OPENCLAW_SHIELD_STEPS } from '@agenshield/ipc';
import type { ShieldingStepProps } from '../SetupPanel.types';
import type { ShieldStepEntry } from '../../../../../state/setup-panel';
import {
  SectionTitle,
  ProgressBar,
  ProgressFill,
  ProgressLabel,
} from '../SetupPanel.styles';

/** Human-readable step names (legacy — used when granular steps aren't available) */
const STEP_LABELS: Record<string, string> = {
  initializing: 'Preparing',
  cleanup_stale: 'Cleaning up stale installations',
  creating_users: 'Creating sandbox users',
  creating_directories: 'Setting up directories',
  installing_guarded_shell: 'Installing guarded shell',
  installing_wrappers: 'Installing command wrappers',
  path_override: 'Configuring PATH router',
  installing_target: 'Installing target app',
  installing_homebrew: 'Installing Homebrew',
  installing_nvm: 'Installing NVM & Node.js',
  copying_node: 'Copying node binary',
  installing_openclaw: 'Installing OpenClaw',
  installing_claude: 'Installing Claude Code',
  stopping_host: 'Stopping host processes',
  copying_config: 'Copying host configuration',
  onboarding: 'Running onboard',
  patching_node: 'Patching node interceptor',
  starting_gateway: 'Starting gateway',
  verifying_binary: 'Verifying installation',
  generating_seatbelt: 'Generating security profile',
  installing_sudoers: 'Configuring sudo rules',
  installing_daemon: 'Installing LaunchDaemon',
  creating_profile: 'Saving profile',
  seeding_policies: 'Applying security policies',
  stopping_processes: 'Stopping processes',
  removing_path: 'Removing PATH override',
  removing_daemons: 'Removing LaunchDaemons',
  removing_sudoers: 'Removing sudo rules',
  removing_seatbelt: 'Removing security profile',
  removing_home: 'Removing agent home',
  removing_users: 'Removing users',
  removing_groups: 'Removing groups',
  removing_policies: 'Removing policies',
  removing_profile: 'Removing profile',
  cleanup: 'Final cleanup',
  complete: 'Complete',
};

/** Group steps by phase, using SSE-provided phase with fallback to static definitions. */
function groupByPhase(steps: ShieldStepEntry[]): Map<number, ShieldStepEntry[]> {
  // Fallback lookup for older daemons that don't send phase in SSE data
  const fallbackMap = new Map<string, number>();
  for (const def of OPENCLAW_SHIELD_STEPS) {
    fallbackMap.set(def.id, def.phase);
  }
  const groups = new Map<number, ShieldStepEntry[]>();
  for (const step of steps) {
    const phase = step.phase ?? fallbackMap.get(step.id) ?? -1;
    if (phase < 0) continue; // Skip unmapped steps instead of showing "Phase -1"
    if (!groups.has(phase)) groups.set(phase, []);
    groups.get(phase)!.push(step);
  }
  return groups;
}

function StepIcon({ status }: { status: ShieldStepEntry['status'] }) {
  switch (status) {
    case 'completed':
      return <CheckCircle size={12} color="#6CB685" />;
    case 'running':
      return <Loader size={12} style={{ animation: 'spin 2s linear infinite', color: '#6BAEF2' }} />;
    case 'failed':
      return <AlertCircle size={12} color="#E1583E" />;
    case 'skipped':
      return <MinusCircle size={12} style={{ opacity: 0.3 }} />;
    default:
      return <Circle size={12} style={{ opacity: 0.2 }} />;
  }
}

function PhaseGroup({
  phase,
  steps,
}: {
  phase: number;
  steps: ShieldStepEntry[];
}) {
  const allDone = steps.every((s) => s.status === 'completed' || s.status === 'skipped');
  const hasRunning = steps.some((s) => s.status === 'running');
  const hasFailed = steps.some((s) => s.status === 'failed');
  const [collapsed, setCollapsed] = useState(false);
  const prevAllDone = useRef(false);

  // Auto-collapse on transition from "not done" to "all done" (unless failed)
  useEffect(() => {
    if (allDone && !hasFailed && !prevAllDone.current) {
      setCollapsed(true);
    }
    prevAllDone.current = allDone;
  }, [allDone, hasFailed]);

  const label = SHIELD_PHASE_LABELS[phase] ?? `Phase ${phase}`;

  return (
    <div style={{ marginBottom: 6 }}>
      <button
        onClick={() => setCollapsed(!collapsed)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          background: 'none',
          border: 'none',
          padding: '4px 0',
          cursor: 'pointer',
          fontSize: 10,
          fontWeight: 600,
          fontFamily: "'Manrope', sans-serif",
          opacity: allDone && !hasFailed ? 0.5 : 0.85,
          color: 'inherit',
          width: '100%',
          textAlign: 'left',
        }}
      >
        {collapsed ? <ChevronDown size={10} /> : <ChevronUp size={10} />}
        {label}
        {allDone && !hasFailed && (
          <CheckCircle size={10} color="#6CB685" style={{ marginLeft: 'auto' }} />
        )}
        {hasFailed && (
          <AlertCircle size={10} color="#E1583E" style={{ marginLeft: 'auto' }} />
        )}
      </button>

      {!collapsed && (
        <div style={{ paddingLeft: 8, opacity: allDone && !hasFailed ? 0.5 : 1 }}>
          {steps.map((step) => (
            <ShieldStepRow key={step.id} step={step} />
          ))}
        </div>
      )}
    </div>
  );
}

function ShieldStepRow({ step }: { step: ShieldStepEntry }) {
  const [expanded, setExpanded] = useState(false);
  const hasLogs = step.logs.length > 0;
  const hasError = step.status === 'failed';

  // Auto-expand on error
  useEffect(() => {
    if (hasError) setExpanded(true);
  }, [hasError]);

  return (
    <div style={{ padding: '2px 0' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          cursor: hasLogs || hasError ? 'pointer' : 'default',
          opacity: step.status === 'skipped' ? 0.4 : step.status === 'pending' ? 0.5 : 1,
        }}
        onClick={() => {
          if (hasLogs || hasError) setExpanded(!expanded);
        }}
      >
        <StepIcon status={step.status} />
        <span style={{
          fontSize: 11,
          fontFamily: "'Manrope', sans-serif",
          flex: 1,
          textDecoration: step.status === 'skipped' ? 'line-through' : 'none',
        }}>
          {step.name}
        </span>
        {step.durationMs != null && step.status !== 'pending' && (
          <span style={{ fontSize: 9, opacity: 0.5, fontFamily: "'IBM Plex Mono', monospace" }}>
            {step.durationMs < 1000 ? `${step.durationMs}ms` : `${(step.durationMs / 1000).toFixed(1)}s`}
          </span>
        )}
      </div>

      {expanded && hasError && step.error && (
        <div style={{
          marginLeft: 18,
          marginTop: 2,
          fontSize: 10,
          fontFamily: "'IBM Plex Mono', monospace",
          color: '#E1583E',
          lineHeight: 1.4,
          wordBreak: 'break-word',
        }}>
          {step.error}
        </div>
      )}

      {expanded && hasLogs && (
        <div style={{
          marginLeft: 18,
          marginTop: 2,
          maxHeight: 100,
          overflowY: 'auto',
          borderRadius: 4,
          padding: '4px 6px',
          backgroundColor: 'rgba(0, 0, 0, 0.03)',
        }}>
          {step.logs.slice(-20).map((log, i) => (
            <div key={i} style={{
              fontSize: 9,
              fontFamily: "'IBM Plex Mono', monospace",
              lineHeight: 1.4,
              opacity: 0.75,
              padding: '1px 0',
            }}>
              {log.message}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function ShieldingStep({ targetId, progress }: ShieldingStepProps) {
  const pct = progress?.progress ?? 0;
  const step = progress?.currentStep ?? 'initializing';
  const message = progress?.message ?? 'Preparing...';
  const isComplete = progress?.status === 'completed';
  const isError = progress?.status === 'error';
  const logs = progress?.logs ?? [];
  const steps = progress?.steps ?? [];
  const hasGranularSteps = steps.length > 0;

  const [logsExpanded, setLogsExpanded] = useState(false);
  const logContainerRef = useRef<HTMLDivElement>(null);
  const scrollTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const stepListRef = useRef<HTMLDivElement>(null);

  // Group steps by phase (memoized)
  const phaseGroups = useMemo(() => groupByPhase(steps), [steps]);
  const sortedPhases = useMemo(
    () => [...phaseGroups.keys()].sort((a, b) => a - b),
    [phaseGroups],
  );

  // Only render the last 30 log entries to avoid DOM bloat
  const MAX_VISIBLE_LOGS = 30;
  const visibleLogs = logsExpanded ? logs.slice(-MAX_VISIBLE_LOGS) : [];
  const hiddenCount = logs.length > MAX_VISIBLE_LOGS ? logs.length - MAX_VISIBLE_LOGS : 0;

  // Auto-expand on error (legacy view)
  useEffect(() => {
    if (isError && !hasGranularSteps) setLogsExpanded(true);
  }, [isError, hasGranularSteps]);

  // Debounced auto-scroll to bottom when new logs arrive (legacy view, 300ms)
  useEffect(() => {
    if (logsExpanded && logContainerRef.current) {
      clearTimeout(scrollTimerRef.current);
      scrollTimerRef.current = setTimeout(() => {
        logContainerRef.current?.scrollTo({ top: logContainerRef.current.scrollHeight });
      }, 300);
    }
    return () => clearTimeout(scrollTimerRef.current);
  }, [logs.length, logsExpanded]);

  // Auto-scroll step list to show running step
  useEffect(() => {
    if (hasGranularSteps && stepListRef.current) {
      const running = stepListRef.current.querySelector('[data-running="true"]');
      if (running) {
        running.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    }
  }, [steps, hasGranularSteps]);

  const stepLabel = STEP_LABELS[step] || step;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ textAlign: 'center', padding: '24px 0 16px', flexShrink: 0 }}>
        <div style={{ marginBottom: 12 }}>
          {isComplete ? (
            <Shield size={32} color="#6CB685" />
          ) : isError ? (
            <Shield size={32} color="#E1583E" />
          ) : (
            <Loader size={32} style={{ animation: 'spin 2s linear infinite', opacity: 0.6 }} />
          )}
        </div>
        <SectionTitle style={{ fontSize: 14, marginBottom: 4 }}>
          {isComplete ? 'Shielding Complete' : isError ? 'Shielding Failed' : 'Shielding Target'}
        </SectionTitle>
        <div style={{ fontSize: 11, opacity: 0.6 }}>
          {targetId}
        </div>
      </div>

      <ProgressBar style={{ flexShrink: 0 }}>
        <ProgressFill $progress={pct} style={isError ? { backgroundColor: '#E1583E' } : undefined} />
      </ProgressBar>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
        <ProgressLabel>{message}</ProgressLabel>
        <ProgressLabel style={{ fontWeight: 600 }}>{Math.round(pct)}%</ProgressLabel>
      </div>

      {/* Granular step checklist (new) */}
      {hasGranularSteps && (
        <div
          ref={stepListRef}
          style={{
            marginTop: 12,
            flex: 1,
            minHeight: 0,
            overflowY: 'auto',
            borderRadius: 6,
            padding: '8px 10px',
            backgroundColor: 'rgba(0, 0, 0, 0.02)',
          }}
        >
          {sortedPhases.map((phase) => (
            <PhaseGroup key={phase} phase={phase} steps={phaseGroups.get(phase)!} />
          ))}
        </div>
      )}

      {/* Legacy flat view (backward compat) */}
      {!hasGranularSteps && (
        <>
          <div style={{ marginTop: 8, fontSize: 11, opacity: 0.5, flexShrink: 0 }}>
            Step: {stepLabel}
          </div>

          {logs.length > 0 && (
            <div style={{ marginTop: 12, flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
              <button
                onClick={() => setLogsExpanded(!logsExpanded)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                  background: 'none',
                  border: 'none',
                  padding: 0,
                  cursor: 'pointer',
                  fontSize: 11,
                  fontFamily: "'Manrope', sans-serif",
                  fontWeight: 500,
                  opacity: 0.7,
                  color: 'inherit',
                  flexShrink: 0,
                }}
              >
                {logsExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                {logsExpanded ? 'Hide details' : 'Show details'} ({logs.length})
              </button>

              {logsExpanded && (
                <div
                  ref={logContainerRef}
                  style={{
                    marginTop: 8,
                    flex: 1,
                    minHeight: 0,
                    overflowY: 'auto',
                    borderRadius: 6,
                    padding: '8px 10px',
                    backgroundColor: 'rgba(0, 0, 0, 0.04)',
                  }}
                >
                  {hiddenCount > 0 && (
                    <div style={{
                      fontSize: 9,
                      fontFamily: "'IBM Plex Mono', monospace",
                      opacity: 0.5,
                      padding: '2px 0 4px',
                    }}>
                      ...{hiddenCount} earlier entries hidden
                    </div>
                  )}
                  {visibleLogs.map((entry, i) => (
                    <div
                      key={i}
                      style={{
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: 6,
                        padding: '3px 0',
                        fontSize: 10,
                        fontFamily: "'IBM Plex Mono', monospace",
                        lineHeight: 1.4,
                        opacity: 0.85,
                      }}
                    >
                      <span style={{ flexShrink: 0, marginTop: 1 }}>
                        {isError && i === visibleLogs.length - 1 ? (
                          <AlertCircle size={10} color="#E1583E" />
                        ) : (
                          <CheckCircle size={10} color="#6CB685" />
                        )}
                      </span>
                      <span style={{ wordBreak: 'break-word' }}>{entry.message}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
