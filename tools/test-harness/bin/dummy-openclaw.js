#!/usr/bin/env node

/**
 * Dummy OpenClaw CLI
 *
 * A minimal OpenClaw-like CLI for testing AgenShield sandbox enforcement.
 * This allows testing without a real OpenClaw installation.
 */

const { program } = require('commander');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Version that mimics OpenClaw
const VERSION = '1.0.0-dummy';

program
  .name('openclaw')
  .version(VERSION)
  .description('Dummy OpenClaw for AgenShield testing');

/**
 * Config command - show/set configuration
 */
program
  .command('config')
  .description('Manage configuration')
  .option('--show', 'Show current configuration')
  .option('--set <key=value>', 'Set a configuration value')
  .action((options) => {
    const configPath = path.join(process.env.HOME || '/tmp', '.openclaw', 'config.json');

    if (options.show) {
      console.log('Configuration:');
      console.log(`  Config path: ${configPath}`);
      console.log(`  Home: ${process.env.HOME || 'not set'}`);
      console.log(`  User: ${process.env.USER || 'not set'}`);
      console.log(`  CWD: ${process.cwd()}`);
      console.log(`  Node: ${process.version}`);

      if (fs.existsSync(configPath)) {
        try {
          const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
          console.log('  Saved config:', JSON.stringify(config, null, 2));
        } catch (e) {
          console.log('  Saved config: (error reading)');
        }
      } else {
        console.log('  Saved config: (none)');
      }
      return;
    }

    if (options.set) {
      const [key, value] = options.set.split('=');
      console.log(`Setting ${key} = ${value}`);
      // In a real implementation, this would save to config file
      console.log('(dummy - not actually saved)');
      return;
    }

    console.log('Use --show to view config or --set key=value to set a value');
  });

/**
 * Run command - simulates agent execution with test behaviors
 */
program
  .command('run')
  .description('Run the agent (will test network/file/exec)')
  .option('--test-network', 'Attempt outbound HTTP request')
  .option('--test-file <path>', 'Attempt to read file')
  .option('--test-exec <cmd>', 'Attempt to execute command')
  .option('--test-write <path>', 'Attempt to write file')
  .option('--verbose', 'Verbose output')
  .action(async (opts) => {
    console.log('Dummy OpenClaw running...');
    console.log(`PID: ${process.pid}`);
    console.log(`User: ${process.env.USER || 'unknown'}`);
    console.log(`Home: ${process.env.HOME || 'unknown'}`);
    console.log('');

    const results = {
      network: null,
      file: null,
      exec: null,
      write: null,
    };

    // Test network access
    if (opts.testNetwork) {
      console.log('Testing network access...');
      try {
        // Try to make a network request
        const https = require('https');
        await new Promise((resolve, reject) => {
          const req = https.get('https://httpbin.org/get', { timeout: 5000 }, (res) => {
            let data = '';
            res.on('data', (chunk) => (data += chunk));
            res.on('end', () => {
              results.network = { success: true, status: res.statusCode };
              console.log(`  Network: SUCCESS (HTTP ${res.statusCode})`);
              if (opts.verbose) {
                console.log(`  Response: ${data.substring(0, 200)}...`);
              }
              resolve();
            });
          });
          req.on('error', (e) => {
            results.network = { success: false, error: e.message };
            console.log(`  Network: BLOCKED (${e.message})`);
            resolve();
          });
          req.on('timeout', () => {
            results.network = { success: false, error: 'timeout' };
            console.log('  Network: BLOCKED (timeout)');
            req.destroy();
            resolve();
          });
        });
      } catch (e) {
        results.network = { success: false, error: e.message };
        console.log(`  Network: BLOCKED (${e.message})`);
      }
      console.log('');
    }

    // Test file read
    if (opts.testFile) {
      console.log(`Testing file read: ${opts.testFile}`);
      try {
        const content = fs.readFileSync(opts.testFile, 'utf-8');
        results.file = { success: true, size: content.length };
        console.log(`  File read: SUCCESS (${content.length} bytes)`);
        if (opts.verbose) {
          console.log(`  Content preview: ${content.substring(0, 100)}...`);
        }
      } catch (e) {
        results.file = { success: false, error: e.message };
        console.log(`  File read: BLOCKED (${e.message})`);
      }
      console.log('');
    }

    // Test file write
    if (opts.testWrite) {
      console.log(`Testing file write: ${opts.testWrite}`);
      try {
        const content = `Test file written at ${new Date().toISOString()}\n`;
        fs.writeFileSync(opts.testWrite, content);
        results.write = { success: true };
        console.log('  File write: SUCCESS');
      } catch (e) {
        results.write = { success: false, error: e.message };
        console.log(`  File write: BLOCKED (${e.message})`);
      }
      console.log('');
    }

    // Test command execution
    if (opts.testExec) {
      console.log(`Testing exec: ${opts.testExec}`);
      try {
        const output = execSync(opts.testExec, { encoding: 'utf-8', timeout: 5000 });
        results.exec = { success: true, output: output.trim() };
        console.log(`  Exec: SUCCESS`);
        if (opts.verbose) {
          console.log(`  Output: ${output.trim()}`);
        }
      } catch (e) {
        results.exec = { success: false, error: e.message };
        console.log(`  Exec: BLOCKED (${e.message})`);
      }
      console.log('');
    }

    // Summary
    console.log('--- Summary ---');
    const tested = Object.entries(results).filter(([_, v]) => v !== null);
    if (tested.length === 0) {
      console.log('No tests were run. Use --test-network, --test-file, --test-exec, or --test-write');
    } else {
      for (const [name, result] of tested) {
        const status = result.success ? 'ALLOWED' : 'BLOCKED';
        console.log(`  ${name}: ${status}`);
      }
    }
  });

/**
 * Chat command - simulates interactive chat (for compatibility)
 */
program
  .command('chat')
  .description('Start interactive chat (dummy)')
  .option('--model <model>', 'Model to use', 'claude-3-opus')
  .action((opts) => {
    console.log(`Dummy OpenClaw Chat (model: ${opts.model})`);
    console.log('This is a dummy implementation for testing.');
    console.log('Type "exit" to quit.');
    console.log('');

    const readline = require('readline');
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    const askQuestion = () => {
      rl.question('You: ', (input) => {
        if (input.toLowerCase() === 'exit') {
          console.log('Goodbye!');
          rl.close();
          return;
        }

        console.log(`Assistant: (dummy response to "${input}")`);
        console.log('');
        askQuestion();
      });
    };

    askQuestion();
  });

/**
 * Agent command - simulates agentic mode
 */
program
  .command('agent')
  .description('Run in agentic mode (dummy)')
  .option('--task <task>', 'Task to perform')
  .action((opts) => {
    console.log('Dummy OpenClaw Agent Mode');
    console.log(`Task: ${opts.task || '(none specified)'}`);
    console.log('');
    console.log('This is a dummy implementation for testing.');
    console.log('In a real agent, this would execute the task autonomously.');
  });

/**
 * Status command - show sandbox status
 */
program
  .command('status')
  .description('Show sandbox and environment status')
  .action(() => {
    console.log('Environment Status:');
    console.log(`  User: ${process.env.USER || 'unknown'}`);
    console.log(`  UID: ${process.getuid?.() || 'N/A'}`);
    console.log(`  GID: ${process.getgid?.() || 'N/A'}`);
    console.log(`  Home: ${process.env.HOME || 'unknown'}`);
    console.log(`  CWD: ${process.cwd()}`);
    console.log(`  PATH: ${process.env.PATH || 'not set'}`);
    console.log('');
    console.log('Sandbox Indicators:');

    // Check if running as sandbox user
    const user = process.env.USER || '';
    const isSandboxed = user.includes('claw') || user.includes('openclaw');
    console.log(`  Running as sandbox user: ${isSandboxed ? 'YES' : 'NO'}`);

    // Check for AgenShield environment variables
    const hasAgenshieldEnv = Object.keys(process.env).some((k) =>
      k.startsWith('AGENSHIELD_')
    );
    console.log(`  AgenShield env vars: ${hasAgenshieldEnv ? 'YES' : 'NO'}`);

    // Check for guarded shell
    const shell = process.env.SHELL || '';
    const isGuardedShell = shell.includes('guarded-shell');
    console.log(`  Guarded shell: ${isGuardedShell ? 'YES' : 'NO'}`);

    // Try to detect if network is blocked
    console.log('');
    console.log('Use "openclaw run --test-network" to test network access');
  });

// Parse command line arguments
program.parse();

// If no command specified, show help
if (!process.argv.slice(2).length) {
  program.outputHelp();
}
