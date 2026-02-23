/**
 * Shielding step — shows progress while a target is being shielded
 * Includes a collapsible log panel showing step-by-step history.
 */

import { useState, useEffect, useRef } from 'react';
import { Shield, Loader, ChevronDown, ChevronUp, CheckCircle, AlertCircle } from 'lucide-react';
import type { ShieldingStepProps } from '../SetupPanel.types';
import {
  SectionTitle,
  ProgressBar,
  ProgressFill,
  ProgressLabel,
} from '../SetupPanel.styles';

/** Human-readable step names */
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
  // Unshield steps
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

export function ShieldingStep({ targetId, progress }: ShieldingStepProps) {
  const pct = progress?.progress ?? 0;
  const step = progress?.currentStep ?? 'initializing';
  const message = progress?.message ?? 'Preparing...';
  const isComplete = progress?.status === 'completed';
  const isError = progress?.status === 'error';
  const logs = progress?.logs ?? [];

  const [logsExpanded, setLogsExpanded] = useState(false);
  const logContainerRef = useRef<HTMLDivElement>(null);
  const scrollTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Only render the last 30 log entries to avoid DOM bloat
  const MAX_VISIBLE_LOGS = 30;
  const visibleLogs = logsExpanded ? logs.slice(-MAX_VISIBLE_LOGS) : [];
  const hiddenCount = logs.length > MAX_VISIBLE_LOGS ? logs.length - MAX_VISIBLE_LOGS : 0;

  // Auto-expand on error
  useEffect(() => {
    if (isError) setLogsExpanded(true);
  }, [isError]);

  // Debounced auto-scroll to bottom when new logs arrive (300ms)
  useEffect(() => {
    if (logsExpanded && logContainerRef.current) {
      clearTimeout(scrollTimerRef.current);
      scrollTimerRef.current = setTimeout(() => {
        logContainerRef.current?.scrollTo({ top: logContainerRef.current.scrollHeight });
      }, 300);
    }
    return () => clearTimeout(scrollTimerRef.current);
  }, [logs.length, logsExpanded]);

  const stepLabel = STEP_LABELS[step] || step;

  return (
    <>
      <div style={{ textAlign: 'center', padding: '24px 0 16px' }}>
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

      <ProgressBar>
        <ProgressFill $progress={pct} style={isError ? { backgroundColor: '#E1583E' } : undefined} />
      </ProgressBar>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <ProgressLabel>{message}</ProgressLabel>
        <ProgressLabel style={{ fontWeight: 600 }}>{pct}%</ProgressLabel>
      </div>

      <div style={{ marginTop: 8, fontSize: 11, opacity: 0.5 }}>
        Step: {stepLabel}
      </div>

      {/* Collapsible log panel */}
      {logs.length > 0 && (
        <div style={{ marginTop: 12 }}>
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
                maxHeight: 200,
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
  );
}
