/**
 * DevApp - Root TUI component for dev mode.
 *
 * Manages phase-driven rendering: ready → prompting → running_action → viewing_logs.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import Spinner from 'ink-spinner';
import { StatusBar } from './components/StatusBar.js';
import { ActionMenu } from './components/ActionMenu.js';
import { PathPrompt } from './components/PathPrompt.js';
import { ActionResult } from './components/ActionResult.js';
import { LogViewer } from './components/LogViewer.js';
import { runTestAction, type ActionId, type TestResult } from './runner.js';
import { getDaemonStatus, type DaemonStatus } from '../utils/daemon.js';
import type { DevState } from './state.js';
import { execSync } from 'node:child_process';
import { DAEMON_CONFIG } from '../utils/daemon.js';

type Phase = 'ready' | 'prompting' | 'running_action' | 'viewing_logs';

interface DevAppProps {
  devState: DevState;
}

export function DevApp({ devState }: DevAppProps) {
  const { exit } = useApp();
  const [phase, setPhase] = useState<Phase>('ready');
  const [daemonStatus, setDaemonStatus] = useState<DaemonStatus>({ running: false });
  const [currentAction, setCurrentAction] = useState<ActionId | null>(null);
  const [lastResult, setLastResult] = useState<TestResult | null>(null);
  const [lastActionLabel, setLastActionLabel] = useState<string>('');
  const [logLines, setLogLines] = useState<string[]>([]);

  // Poll daemon status every 5 seconds
  useEffect(() => {
    const refresh = async () => {
      const status = await getDaemonStatus();
      setDaemonStatus(status);
    };
    refresh();
    const interval = setInterval(refresh, 5000);
    return () => clearInterval(interval);
  }, []);

  // Handle Esc in prompting/viewing phases
  useInput((input, key) => {
    if (key.escape) {
      if (phase === 'prompting' || phase === 'viewing_logs') {
        setPhase('ready');
      }
    }
    if (phase === 'viewing_logs' && key.return) {
      setPhase('ready');
    }
  });

  const handleActionSelect = useCallback((action: ActionId) => {
    if (action === 'quit') {
      exit();
      return;
    }

    if (action === 'view-logs') {
      // Read last 30 lines of daemon log
      try {
        const logFile = `${DAEMON_CONFIG.LOG_DIR}/daemon.log`;
        const output = execSync(`tail -30 "${logFile}" 2>/dev/null || echo "(no logs found)"`, {
          encoding: 'utf-8',
          timeout: 5000,
        });
        setLogLines(output.trim().split('\n'));
      } catch {
        setLogLines(['(could not read daemon logs)']);
      }
      setPhase('viewing_logs');
      return;
    }

    // Actions that need additional input
    if (action === 'test-file-read' || action === 'test-file-write' || action === 'test-exec') {
      setCurrentAction(action);
      setPhase('prompting');
      return;
    }

    // Direct actions (test-network, show-status)
    setCurrentAction(action);
    setPhase('running_action');
    setLastActionLabel(action);

    const result = runTestAction(action, devState.agentUsername, devState.testHarnessPath, undefined, devState.nodePath);
    setLastResult(result);
    setPhase('ready');
  }, [devState, exit]);

  const handlePromptSubmit = useCallback((value: string) => {
    if (!currentAction) return;

    setPhase('running_action');
    setLastActionLabel(currentAction);

    const params = currentAction === 'test-exec'
      ? { command: value }
      : { path: value };

    const result = runTestAction(currentAction, devState.agentUsername, devState.testHarnessPath, params, devState.nodePath);
    setLastResult(result);
    setCurrentAction(null);
    setPhase('ready');
  }, [currentAction, devState]);

  const handlePromptCancel = useCallback(() => {
    setCurrentAction(null);
    setPhase('ready');
  }, []);

  const handleLogBack = useCallback(() => {
    setPhase('ready');
  }, []);

  return (
    <Box flexDirection="column" padding={1}>
      <StatusBar
        daemonStatus={daemonStatus}
        agentUsername={devState.agentUsername}
        prefix={devState.prefix}
      />

      {/* Show last result above the menu */}
      {lastResult && phase === 'ready' && (
        <ActionResult action={lastActionLabel} result={lastResult} />
      )}

      {phase === 'ready' && (
        <ActionMenu onSelect={handleActionSelect} />
      )}

      {phase === 'prompting' && currentAction && (
        <PathPrompt
          action={currentAction}
          onSubmit={handlePromptSubmit}
          onCancel={handlePromptCancel}
        />
      )}

      {phase === 'running_action' && (
        <Box>
          <Text color="cyan">
            <Spinner type="dots" />
          </Text>
          <Text> Running {currentAction}...</Text>
        </Box>
      )}

      {phase === 'viewing_logs' && (
        <LogViewer lines={logLines} onBack={handleLogBack} />
      )}

      {/* Footer */}
      <Box marginTop={1}>
        <Text color="gray" dimColor>
          q: quit | Arrows + Enter: select action
        </Text>
      </Box>
    </Box>
  );
}
