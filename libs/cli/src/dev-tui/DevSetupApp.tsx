/**
 * DevSetupApp — Wizard-like interactive setup for dev mode.
 *
 * Phase 1 of the dev flow. Handles prerequisites check, mode selection,
 * naming configuration, confirmation, and OS-level setup (users/groups/dirs).
 * Returns a DevState on completion.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import Spinner from 'ink-spinner';
import { DevModeSelect, type DevSetupMode } from './components/DevModeSelect.js';
import { DevConfirm } from './components/DevConfirm.js';
import { AdvancedConfig, computeNames, type ComputedNames } from '../wizard/components/AdvancedConfig.js';
import {
  checkPrerequisites,
  autoDetectPreset,
  createUserConfig,
  createGroups,
  createAgentUser,
  createBrokerUser,
  createAllDirectories,
  setupSocketDirectory,
  userExists,
  groupExists,
  DEFAULT_BASE_NAME,
} from '@agenshield/sandbox';
import { BUILTIN_SKILLS_DIR, getSoulContent } from '@agenshield/skills';
import type { DevState } from './state.js';
import { findTestHarness } from '../utils/find-test-harness.js';
import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

type DevSetupPhase =
  | 'detecting'
  | 'mode_select'
  | 'advanced_config'
  | 'confirming'
  | 'setting_up'
  | 'complete';

interface SetupStep {
  name: string;
  status: 'pending' | 'running' | 'done' | 'error';
  message?: string;
}

interface DevSetupAppProps {
  options: {
    prefix?: string;
    baseName?: string;
    baseUid?: number;
    baseGid?: number;
  };
  onComplete: (state: DevState) => void;
  onWebUI?: () => void;
}

const DEV_PREFIX = 'dev';
const DEV_BASE_UID = 5400;
const DEV_BASE_GID = 5300;

const SKILL_NAMES = [
  'agentlink-secure-integrations',
  'soul-shield',
  'policy-enforce',
  'secret-broker',
  'security-check',
];

function copyDirRecursive(src: string, dest: string): void {
  if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      copyDirRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

async function checkConflicts(names: ComputedNames): Promise<{ users: string[]; groups: string[] }> {
  const existingUsers: string[] = [];
  const existingGroups: string[] = [];

  if (await userExists(names.agentUser)) existingUsers.push(names.agentUser);
  if (await userExists(names.brokerUser)) existingUsers.push(names.brokerUser);
  if (await groupExists(names.socketGroup)) existingGroups.push(names.socketGroup);
  if (await groupExists(names.workspaceGroup)) existingGroups.push(names.workspaceGroup);

  return { users: existingUsers, groups: existingGroups };
}

export function DevSetupApp({ options, onComplete, onWebUI }: DevSetupAppProps) {
  const { exit } = useApp();
  const [phase, setPhase] = useState<DevSetupPhase>('detecting');
  const [error, setError] = useState<string | null>(null);
  const [detectedTarget, setDetectedTarget] = useState<{ name: string; version?: string } | null>(null);
  const [baseName, setBaseName] = useState(options.baseName || DEFAULT_BASE_NAME);
  const [steps, setSteps] = useState<SetupStep[]>([]);

  const prefix = options.prefix || DEV_PREFIX;
  const baseUid = options.baseUid || DEV_BASE_UID;
  const baseGid = options.baseGid || DEV_BASE_GID;

  // Compute display names based on current baseName
  const displayNames = computeNames(baseName);
  // But we use the dev prefix for actual user creation
  const config = createUserConfig({ prefix, baseName, baseUid, baseGid });

  const devUserNames = {
    agentUser: config.agentUser.username,
    brokerUser: config.brokerUser.username,
    socketGroup: config.groups.socket.name,
    workspaceGroup: config.groups.workspace.name,
  };

  // Phase: detecting — check prerequisites and detect target
  useEffect(() => {
    if (phase !== 'detecting') return;

    (async () => {
      // Check prerequisites
      const prereqs = checkPrerequisites();
      if (!prereqs.ok) {
        setError(`Prerequisites not met:\n${prereqs.missing.map(m => `  - ${m}`).join('\n')}`);
        return;
      }

      // Detect installed target (informational only)
      try {
        const detected = await autoDetectPreset();
        if (detected) {
          setDetectedTarget({
            name: detected.preset.name,
            version: detected.detection.version,
          });
        }
      } catch {
        // Detection failure is non-fatal for dev mode
      }

      // Find test harness
      const testHarness = findTestHarness();
      if (!testHarness) {
        setError('Test harness not found. Run from project root or install test-harness.');
        return;
      }

      // If baseName was provided via CLI option, skip mode selection
      if (options.baseName) {
        setPhase('confirming');
      } else {
        setPhase('mode_select');
      }
    })();
  }, [phase]);

  // Handle mode selection
  const handleModeSelect = useCallback((mode: DevSetupMode) => {
    if (mode === 'webui') {
      onWebUI?.();
      exit();
      return;
    }
    if (mode === 'quick') {
      setBaseName(DEFAULT_BASE_NAME);
      setPhase('confirming');
    } else {
      setPhase('advanced_config');
    }
  }, [onWebUI, exit]);

  // Handle advanced config confirmation
  const handleAdvancedConfig = useCallback((values: { agentSuffix: string }) => {
    setBaseName(values.agentSuffix);
    setPhase('confirming');
  }, []);

  // Handle confirmation
  const handleConfirm = useCallback(() => {
    setPhase('setting_up');
  }, []);

  const handleCancel = useCallback(() => {
    exit();
  }, [exit]);

  // Phase: setting_up — execute setup steps
  useEffect(() => {
    if (phase !== 'setting_up') return;

    const cfg = createUserConfig({ prefix, baseName, baseUid, baseGid });

    const setupSteps: SetupStep[] = [
      { name: 'Create groups', status: 'pending' },
      { name: 'Create agent user', status: 'pending' },
      { name: 'Create broker user', status: 'pending' },
      { name: 'Create directories', status: 'pending' },
      { name: 'Setup socket directory', status: 'pending' },
      { name: 'Copy node binary', status: 'pending' },
      { name: 'Copy test harness', status: 'pending' },
      { name: 'Inject dev skills', status: 'pending' },
      { name: 'Configure soul', status: 'pending' },
    ];
    setSteps([...setupSteps]);

    const updateStep = (index: number, status: SetupStep['status'], message?: string) => {
      setupSteps[index].status = status;
      if (message) setupSteps[index].message = message;
      setSteps([...setupSteps]);
    };

    (async () => {
      try {
        // 1. Create groups
        updateStep(0, 'running');
        const groupResults = await createGroups(cfg);
        if (groupResults.some(r => !r.success)) {
          const failed = groupResults.filter(r => !r.success).map(r => r.message).join(', ');
          updateStep(0, 'error', failed);
          setError(`Failed to create groups: ${failed}`);
          return;
        }
        updateStep(0, 'done');

        // 2. Create agent user
        updateStep(1, 'running');
        const agentResult = await createAgentUser(cfg);
        if (!agentResult.success) {
          updateStep(1, 'error', agentResult.message);
          setError(`Failed to create agent user: ${agentResult.message}`);
          return;
        }
        updateStep(1, 'done');

        // 3. Create broker user
        updateStep(2, 'running');
        const brokerResult = await createBrokerUser(cfg);
        if (!brokerResult.success) {
          updateStep(2, 'error', brokerResult.message);
          setError(`Failed to create broker user: ${brokerResult.message}`);
          return;
        }
        updateStep(2, 'done');

        // 4. Create directories
        updateStep(3, 'running');
        const dirResults = await createAllDirectories(cfg);
        const dirFailed = dirResults.filter(r => !r.success);
        if (dirFailed.length > 0) {
          updateStep(3, 'error', dirFailed.map(r => r.message).join(', '));
          // Non-fatal: continue but log
        } else {
          updateStep(3, 'done');
        }

        // 5. Setup socket directory
        updateStep(4, 'running');
        const socketResult = await setupSocketDirectory(cfg);
        if (!socketResult.success) {
          updateStep(4, 'error', socketResult.message);
          // Non-fatal
        } else {
          updateStep(4, 'done');
        }

        // 6. Copy node binary to agent bin dir
        updateStep(5, 'running');
        const agentBinDir = path.join(cfg.agentUser.home, 'bin');
        const nodeDest = path.join(agentBinDir, 'node');
        try {
          fs.mkdirSync(agentBinDir, { recursive: true });
          fs.copyFileSync(process.execPath, nodeDest);
          fs.chmodSync(nodeDest, 0o755);
          updateStep(5, 'done');
        } catch (err) {
          updateStep(5, 'error', (err as Error).message);
          setError(`Failed to copy node binary: ${(err as Error).message}`);
          return;
        }

        // 7. Copy test harness to agent's bin dir
        updateStep(6, 'running');
        const testHarnessSource = findTestHarness();
        const harnessDestPath = path.join(cfg.agentUser.home, 'bin', 'dummy-openclaw.js');
        if (testHarnessSource) {
          try {
            fs.copyFileSync(testHarnessSource, harnessDestPath);
            fs.chmodSync(harnessDestPath, 0o755);
            updateStep(6, 'done');
          } catch (err) {
            updateStep(6, 'error', (err as Error).message);
          }
        } else {
          updateStep(6, 'error', 'Test harness source not found');
        }

        // 8. Inject dev skills
        updateStep(7, 'running');
        const devSkillsDir = path.join(cfg.agentUser.home, '.openclaw-dev', 'skills');
        try {
          fs.mkdirSync(devSkillsDir, { recursive: true });
          for (const name of SKILL_NAMES) {
            const src = path.join(BUILTIN_SKILLS_DIR, name);
            if (fs.existsSync(src)) {
              copyDirRecursive(src, path.join(devSkillsDir, name));
            }
          }
          // Set ownership: root-owned, agent reads via socket group
          execSync(`chown -R root:${cfg.groups.socket.name} "${path.join(cfg.agentUser.home, '.openclaw-dev')}"`, { stdio: 'pipe' });
          execSync(`chmod -R a+rX,go-w "${devSkillsDir}"`, { stdio: 'pipe' });
          updateStep(7, 'done');
        } catch (err) {
          updateStep(7, 'error', (err as Error).message);
        }

        // 9. Configure soul (write shield.json in dev config location)
        updateStep(8, 'running');
        try {
          const devConfigDir = path.join(cfg.agentUser.home, '.openclaw-dev');
          const shieldConfigPath = path.join(devConfigDir, 'shield.json');
          const soulContent = getSoulContent('medium');
          const shieldConfig = {
            soul: {
              enabled: true,
              mode: 'prepend',
              securityLevel: 'medium',
              content: soulContent,
            },
            skills: {
              dir: devSkillsDir,
              enabled: SKILL_NAMES,
            },
          };
          fs.writeFileSync(shieldConfigPath, JSON.stringify(shieldConfig, null, 2));
          execSync(`chown root:${cfg.groups.socket.name} "${shieldConfigPath}" && chmod 640 "${shieldConfigPath}"`, { stdio: 'pipe' });
          updateStep(8, 'done');
        } catch (err) {
          updateStep(8, 'error', (err as Error).message);
        }

        // Build DevState
        const state: DevState = {
          version: '1.0',
          createdAt: new Date().toISOString(),
          lastUsedAt: new Date().toISOString(),
          prefix,
          baseName,
          agentUsername: cfg.agentUser.username,
          brokerUsername: cfg.brokerUser.username,
          socketGroupName: cfg.groups.socket.name,
          workspaceGroupName: cfg.groups.workspace.name,
          baseUid,
          baseGid,
          testHarnessPath: harnessDestPath,
          nodePath: nodeDest,
          skillsDir: devSkillsDir,
          installedSkills: SKILL_NAMES,
        };

        setPhase('complete');
        onComplete(state);
        // Unmount Ink app so the next render (DevApp) can take over
        exit();
      } catch (err) {
        setError(`Setup failed: ${(err as Error).message}`);
      }
    })();
  }, [phase, prefix, baseName, baseUid, baseGid, onComplete, exit]);

  // Allow exiting on error or any phase via Ctrl+C
  useInput((_input, key) => {
    if (error && key.return) {
      exit();
    }
  });

  // Error display
  if (error) {
    return (
      <Box flexDirection="column" padding={1}>
        <Box flexDirection="column" borderStyle="round" borderColor="red" padding={1}>
          <Text bold color="red">Setup Error</Text>
          <Text color="red">{error}</Text>
        </Box>
        <Box marginTop={1}>
          <Text color="gray" dimColor>Press Enter to exit. Fix the issue and try again.</Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" padding={1}>
      <Box flexDirection="column" borderStyle="round" borderColor="magenta" padding={1}>
        <Text bold color="magenta">AgenShield Dev Mode</Text>
      </Box>

      {/* Detecting phase */}
      {phase === 'detecting' && (
        <Box marginTop={1}>
          <Text color="cyan">
            <Spinner type="dots" />
          </Text>
          <Text> Checking prerequisites and detecting targets...</Text>
        </Box>
      )}

      {/* Mode selection */}
      {phase === 'mode_select' && (
        <DevModeSelect
          onSelect={handleModeSelect}
          onCancel={handleCancel}
        />
      )}

      {/* Advanced config */}
      {phase === 'advanced_config' && (
        <AdvancedConfig
          onConfirm={handleAdvancedConfig}
          onCancel={handleCancel}
          onCheckConflicts={checkConflicts}
        />
      )}

      {/* Confirmation */}
      {phase === 'confirming' && (
        <DevConfirm
          userNames={devUserNames}
          detectedTarget={detectedTarget}
          onConfirm={handleConfirm}
          onCancel={handleCancel}
        />
      )}

      {/* Setting up */}
      {phase === 'setting_up' && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold>Setting up dev environment...</Text>
          <Box flexDirection="column" marginTop={1} marginLeft={2}>
            {steps.map((step, i) => (
              <Box key={i}>
                <Text color={
                  step.status === 'done' ? 'green' :
                  step.status === 'running' ? 'cyan' :
                  step.status === 'error' ? 'red' : 'gray'
                }>
                  {step.status === 'done' ? '✓' :
                   step.status === 'running' ? '◌' :
                   step.status === 'error' ? '✗' : '·'}
                </Text>
                <Text> {step.name}</Text>
                {step.message && <Text color="gray"> — {step.message}</Text>}
              </Box>
            ))}
          </Box>
        </Box>
      )}

      {/* Complete */}
      {phase === 'complete' && (
        <Box marginTop={1}>
          <Text color="green" bold>Dev environment ready!</Text>
        </Box>
      )}
    </Box>
  );
}
