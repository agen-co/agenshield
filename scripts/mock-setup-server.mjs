/**
 * Mock setup server for UI development
 *
 * Serves dummy data on port 6969 so the Vite dev server (port 4200)
 * can proxy /api and /sse to it and render the setup wizard.
 *
 * Usage: node scripts/mock-setup-server.mjs
 */

import http from 'node:http';

const PORT = 6969;

// --- Dummy data ---

const DUMMY_EXECUTABLES = [
  { name: 'node', path: '/usr/local/bin/node', dir: '/usr/local/bin', isProxied: false, isWrapped: false, isAllowed: true, category: 'other' },
  { name: 'python3', path: '/usr/bin/python3', dir: '/usr/bin', isProxied: false, isWrapped: false, isAllowed: true, category: 'other' },
  { name: 'npm', path: '/usr/local/bin/npm', dir: '/usr/local/bin', isProxied: false, isWrapped: false, isAllowed: false, category: 'package-manager' },
  { name: 'pip', path: '/usr/local/bin/pip', dir: '/usr/local/bin', isProxied: false, isWrapped: false, isAllowed: false, category: 'package-manager' },
  { name: 'curl', path: '/usr/bin/curl', dir: '/usr/bin', isProxied: false, isWrapped: false, isAllowed: false, category: 'network' },
  { name: 'wget', path: '/usr/bin/wget', dir: '/usr/bin', isProxied: false, isWrapped: false, isAllowed: false, category: 'network' },
  { name: 'bash', path: '/bin/bash', dir: '/bin', isProxied: false, isWrapped: false, isAllowed: true, category: 'shell' },
  { name: 'zsh', path: '/bin/zsh', dir: '/bin', isProxied: false, isWrapped: false, isAllowed: true, category: 'shell' },
  { name: 'git', path: '/usr/bin/git', dir: '/usr/bin', isProxied: false, isWrapped: false, isAllowed: false, category: 'system' },
  { name: 'ssh', path: '/usr/bin/ssh', dir: '/usr/bin', isProxied: false, isWrapped: false, isAllowed: false, category: 'network' },
  { name: 'ruby', path: '/usr/bin/ruby', dir: '/usr/bin', isProxied: false, isWrapped: false, isAllowed: true, category: 'other' },
  { name: 'cargo', path: '/Users/user/.cargo/bin/cargo', dir: '/Users/user/.cargo/bin', isProxied: false, isWrapped: false, isAllowed: false, category: 'package-manager' },
];

const DUMMY_DISCOVERY = {
  binaries: DUMMY_EXECUTABLES.map(e => ({
    name: e.name,
    path: e.path,
    dir: e.dir,
    protection: e.isProxied ? 'proxied' : e.isWrapped ? 'wrapped' : e.isAllowed ? 'allowed' : 'none',
    category: e.category,
  })),
  skills: [],
  preset: { id: 'dev-harness', name: 'Dev Harness' },
};

let wizardState = {
  currentStep: 0,
  steps: [
    { id: 'prerequisites', name: 'Check Prerequisites', description: 'Verify system requirements', status: 'completed' },
    { id: 'detect', name: 'Detect Environment', description: 'Scan for agent executables', status: 'completed' },
    { id: 'configure', name: 'Configure', description: 'Select mode and options', status: 'pending' },
    { id: 'confirm', name: 'Confirm', description: 'Review and confirm settings', status: 'pending' },
    { id: 'create-groups', name: 'Create Groups', description: 'Create sandbox groups', status: 'pending' },
    { id: 'create-agent-user', name: 'Create Agent User', description: 'Create sandboxed agent user', status: 'pending' },
    { id: 'create-broker-user', name: 'Create Broker User', description: 'Create broker user', status: 'pending' },
    { id: 'create-directories', name: 'Create Directories', description: 'Set up directory structure', status: 'pending' },
    { id: 'setup-socket', name: 'Setup Socket', description: 'Configure Unix socket', status: 'pending' },
    { id: 'generate-seatbelt', name: 'Generate Seatbelt', description: 'Generate macOS sandbox profile', status: 'pending' },
    { id: 'install-wrappers', name: 'Install Wrappers', description: 'Install command wrappers', status: 'pending' },
    { id: 'install-broker', name: 'Install Broker', description: 'Install broker service', status: 'pending' },
    { id: 'install-daemon-config', name: 'Install Daemon Config', description: 'Install daemon configuration', status: 'pending' },
    { id: 'install-policies', name: 'Install Policies', description: 'Install default policies', status: 'pending' },
    { id: 'setup-launchdaemon', name: 'Setup LaunchDaemon', description: 'Register launchd service', status: 'pending' },
    { id: 'verify', name: 'Verify', description: 'Verify installation', status: 'pending' },
    { id: 'setup-passcode', name: 'Setup Passcode', description: 'Configure passcode', status: 'pending' },
    { id: 'complete', name: 'Complete', description: 'Setup complete', status: 'pending' },
  ],
  isComplete: false,
  hasError: false,
};

let context = {
  presetDetection: { found: true, id: 'dev-harness', name: 'Dev Harness' },
  options: { prefix: 'dev', baseName: 'default', baseUid: 5400, baseGid: 5300 },
  presetName: 'Dev Harness',
  presetId: 'dev-harness',
};

let phase = 'detection';

// SSE clients
const sseClients = new Set();

function broadcast(eventType, data) {
  const msg = `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of sseClients) {
    res.write(msg);
  }
}

// --- Simulate execution steps ---
async function simulateExecution() {
  const executionSteps = [
    'create-groups', 'create-agent-user', 'create-broker-user', 'create-directories',
    'setup-socket', 'generate-seatbelt', 'install-wrappers', 'install-broker',
    'install-daemon-config', 'install-policies', 'setup-launchdaemon', 'verify',
  ];

  for (const stepId of executionSteps) {
    const step = wizardState.steps.find(s => s.id === stepId);
    if (step) {
      step.status = 'running';
      wizardState.currentStep = wizardState.steps.indexOf(step);
      broadcast('setup:state_change', { state: wizardState, context, phase: 'execution' });
      await new Promise(r => setTimeout(r, 600 + Math.random() * 400));
      step.status = 'completed';
      broadcast('setup:state_change', { state: wizardState, context, phase: 'execution' });
    }
  }
  phase = 'passcode';
  broadcast('setup:state_change', { state: wizardState, context, phase: 'passcode' });
}

// --- HTTP server ---

function json(res, data, status = 200) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try { resolve(JSON.parse(body)); } catch { resolve({}); }
    });
  });
}

const server = http.createServer(async (req, res) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    return res.end();
  }

  const url = req.url;

  // --- SSE ---
  if (url === '/sse/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });
    sseClients.add(res);
    res.write(`event: heartbeat\ndata: ${JSON.stringify({ timestamp: new Date().toISOString(), connected: true })}\n\n`);
    const hb = setInterval(() => {
      res.write(`event: heartbeat\ndata: ${JSON.stringify({ timestamp: new Date().toISOString() })}\n\n`);
    }, 15000);
    req.on('close', () => {
      sseClients.delete(res);
      clearInterval(hb);
    });
    return;
  }

  // --- API routes ---
  if (url === '/api/health') {
    return json(res, { success: true, data: { ok: true, timestamp: new Date().toISOString(), mode: 'setup' } });
  }

  if (url === '/api/auth/status') {
    return json(res, { protectionEnabled: false, passcodeSet: false, allowAnonymousReadOnly: true, lockedOut: false });
  }

  if (url === '/api/setup/state') {
    return json(res, { success: true, data: { state: wizardState, context, phase } });
  }

  if (url === '/api/setup/executables') {
    return json(res, { success: true, data: { discovery: DUMMY_DISCOVERY, executables: DUMMY_EXECUTABLES } });
  }

  if (url === '/api/setup/configure' && req.method === 'POST') {
    const body = await readBody(req);
    const baseName = body.mode === 'quick' ? 'default' : (body.baseName || 'default');
    context.options.baseName = baseName;
    phase = 'configuration';
    const names = {
      agentUser: `_agenshield_${baseName}`,
      brokerUser: `_agenshield_${baseName}_broker`,
      socketGroup: `_agenshield_${baseName}_sock`,
      workspaceGroup: `_agenshield_${baseName}_ws`,
    };
    broadcast('setup:state_change', { state: wizardState, context, phase });
    return json(res, { success: true, data: { mode: body.mode, baseName, names } });
  }

  if (url === '/api/setup/check-conflicts' && req.method === 'POST') {
    const body = await readBody(req);
    const baseName = body.baseName || 'default';
    return json(res, {
      success: true,
      data: {
        hasConflicts: false,
        users: [],
        groups: [],
        names: {
          agentUser: `_agenshield_${baseName}`,
          brokerUser: `_agenshield_${baseName}_broker`,
          socketGroup: `_agenshield_${baseName}_sock`,
          workspaceGroup: `_agenshield_${baseName}_ws`,
        },
      },
    });
  }

  if (url === '/api/setup/confirm' && req.method === 'POST') {
    phase = 'execution';
    // Mark configure and confirm as completed
    wizardState.steps.find(s => s.id === 'configure').status = 'completed';
    wizardState.steps.find(s => s.id === 'confirm').status = 'completed';
    broadcast('setup:state_change', { state: wizardState, context, phase });
    // Start simulated execution
    simulateExecution();
    return json(res, { success: true, data: { started: true } });
  }

  if (url === '/api/setup/passcode' && req.method === 'POST') {
    const body = await readBody(req);
    wizardState.steps.find(s => s.id === 'setup-passcode').status = 'completed';
    wizardState.steps.find(s => s.id === 'complete').status = 'completed';
    wizardState.isComplete = true;
    phase = 'complete';
    broadcast('setup:complete', { state: wizardState, context });
    return json(res, { success: true, data: { started: true } });
  }

  // Fallback
  json(res, { error: 'Not found' }, 404);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Mock setup server running on http://localhost:${PORT}`);
  console.log(`Open http://localhost:4200 in browser (Vite dev server proxies to here)`);
  console.log('');
  console.log('Press Ctrl+C to stop');
});
