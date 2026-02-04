/**
 * Authentication Command
 *
 * Handles AgentLink gateway authentication via the AgenShield daemon.
 * All authentication logic runs in the daemon; this CLI just forwards requests.
 */

import { Command } from 'commander';
import open from 'open';
import * as http from 'node:http';
import {
  requireDaemon,
  authStart,
  authCallback,
  authStatus,
  authLogout,
} from '../lib/daemon-client.js';

/**
 * Wait for OAuth callback on local server
 */
function waitForCallback(port: number, expectedState: string): Promise<{ code: string }> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url || '/', `http://localhost:${port}`);

      if (url.pathname === '/callback') {
        const code = url.searchParams.get('code');
        const state = url.searchParams.get('state');
        const error = url.searchParams.get('error');
        const errorDescription = url.searchParams.get('error_description');

        if (error) {
          res.writeHead(400, { 'Content-Type': 'text/html' });
          res.end(`
            <!DOCTYPE html>
            <html>
            <head>
              <title>Authentication Failed</title>
              <style>
                body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; max-width: 600px; margin: 50px auto; padding: 20px; }
                h1 { color: #dc3545; }
                .error { background: #f8d7da; border: 1px solid #f5c6cb; padding: 15px; border-radius: 5px; }
              </style>
            </head>
            <body>
              <h1>Authentication Failed</h1>
              <div class="error">
                <strong>Error:</strong> ${error}<br>
                ${errorDescription ? `<strong>Details:</strong> ${errorDescription}` : ''}
              </div>
              <p>Please close this window and try again.</p>
            </body>
            </html>
          `);
          server.close();
          reject(new Error(`OAuth error: ${error} - ${errorDescription || ''}`));
          return;
        }

        if (!code || state !== expectedState) {
          res.writeHead(400, { 'Content-Type': 'text/html' });
          res.end(`
            <!DOCTYPE html>
            <html>
            <head><title>Invalid Callback</title></head>
            <body>
              <h1>Invalid Callback</h1>
              <p>Missing or invalid parameters.</p>
            </body>
            </html>
          `);
          server.close();
          reject(new Error('Invalid callback - missing code or state mismatch'));
          return;
        }

        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`
          <!DOCTYPE html>
          <html>
          <head>
            <title>Authentication Successful</title>
            <style>
              body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; max-width: 600px; margin: 50px auto; padding: 20px; text-align: center; }
              h1 { color: #28a745; }
              .success { background: #d4edda; border: 1px solid #c3e6cb; padding: 20px; border-radius: 5px; margin: 20px 0; }
            </style>
          </head>
          <body>
            <h1>Authentication Successful!</h1>
            <div class="success">
              <p>You have successfully authenticated with AgentLink.</p>
              <p>You can close this window and return to your terminal.</p>
            </div>
            <script>setTimeout(() => window.close(), 3000);</script>
          </body>
          </html>
        `);

        server.close();
        resolve({ code });
      } else {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found');
      }
    });

    server.listen(port, () => {
      // Server started
    });

    server.on('error', (err) => {
      if ((err as NodeJS.ErrnoException).code === 'EADDRINUSE') {
        reject(new Error(`Port ${port} is already in use. Close any other agentlink auth processes.`));
      } else {
        reject(err);
      }
    });

    // Timeout after 5 minutes
    const timeoutId = setTimeout(() => {
      server.close();
      reject(new Error('Authentication timeout. Please try again.'));
    }, 300000);

    server.on('close', () => {
      clearTimeout(timeoutId);
    });
  });
}

/**
 * Run the full authentication flow
 */
async function runAuthFlow(): Promise<void> {
  console.log('\n  AgentLink Authentication\n');

  // Ensure daemon is running
  await requireDaemon();

  console.log('  Starting authentication...\n');

  // Start auth flow via daemon
  const startResult = await authStart();

  if (!startResult.success || !startResult.data) {
    console.error(`  Error: ${startResult.error || 'Failed to start auth'}\n`);
    process.exit(1);
  }

  const { authUrl, state, callbackPort } = startResult.data;

  console.log('  Opening browser for authentication...\n');
  console.log(`  If browser doesn't open, visit:\n  ${authUrl}\n`);

  try {
    await open(authUrl);
  } catch {
    console.log('  Could not open browser automatically.');
    console.log('  Please open the URL above manually.\n');
  }

  // Wait for callback
  console.log('  Waiting for authentication...');

  try {
    const { code } = await waitForCallback(callbackPort, state);

    // Send callback to daemon
    const callbackResult = await authCallback(code, state);

    if (!callbackResult.success) {
      console.error(`\n  Authentication failed: ${callbackResult.error}\n`);
      process.exit(1);
    }

    console.log('\n  Authentication successful!\n');
    console.log('  AgentLink is now configured. You can use secure integrations');
    console.log('  by asking OpenClaw to interact with Slack, Jira, GitHub, etc.\n');
    console.log('  Your credentials are stored securely in AgentLink\'s cloud vault.');
    console.log('  OpenClaw will never see your API keys.\n');
  } catch (error) {
    console.error(`\n  Authentication failed: ${(error as Error).message}\n`);
    process.exit(1);
  }
}

/**
 * Show authentication status
 */
async function showStatus(): Promise<void> {
  await requireDaemon();

  const result = await authStatus();

  console.log('\n  AgentLink Authentication Status\n');

  if (!result.success || !result.data) {
    console.error(`  Error: ${result.error || 'Failed to get status'}\n`);
    process.exit(1);
  }

  const { authenticated, expired, expiresAt, connectedIntegrations } = result.data;

  if (!authenticated && !expired) {
    console.log('  Status: Not authenticated');
    console.log('\n  Run "agentlink auth" to authenticate.\n');
    return;
  }

  if (expired) {
    console.log('  Status: Expired');
    console.log(`  Expired at: ${expiresAt || 'Unknown'}`);
    console.log('\n  Run "agentlink auth" to re-authenticate.\n');
    return;
  }

  console.log('  Status: Authenticated');
  console.log(`  Expires at: ${expiresAt || 'Unknown'}`);
  console.log(`  Connected integrations: ${connectedIntegrations.length}`);
  console.log('\n  Your AgentLink session is active.\n');
}

/**
 * Log out and clear stored credentials
 */
async function logout(): Promise<void> {
  await requireDaemon();

  const result = await authLogout();

  if (!result.success) {
    console.error(`  Error: ${result.error}\n`);
    process.exit(1);
  }

  console.log('\n  Logged out successfully.\n');
  console.log('  Your local AgentLink credentials have been removed.');
  console.log('  Note: Integration tokens remain in the AgentLink vault.\n');
}

/**
 * Create the auth command
 */
export function createAuthCommand(): Command {
  const cmd = new Command('auth')
    .description('Authenticate with AgentLink gateway');

  cmd
    .command('login')
    .description('Start OAuth authentication flow')
    .action(runAuthFlow);

  cmd
    .command('status')
    .description('Show authentication status')
    .action(showStatus);

  cmd
    .command('logout')
    .description('Remove stored credentials')
    .action(logout);

  // Default action (no subcommand) - run auth flow
  cmd.action(runAuthFlow);

  return cmd;
}
