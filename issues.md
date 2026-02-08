F-davidfrontegg% openclaw status      
[AgenShield] Interceptors registered via ESM loader
[AgenShield] Interceptors registered via ESM loader

🦞 OpenClaw 2026.2.1 (ed4529e) — We ship features faster than Apple ships calculator updates.

[openclaw] Failed to start CLI: Error: setRawMode EPERM
at ReadStream.setRawMode (node:tty:81:24)
at [_setRawMode] [as _setRawMode] (node:internal/readline/interface:418:18)
at Interface.InterfaceConstructor (node:internal/readline/interface:330:22)
at new Interface (node:readline:115:3)
at Module.createInterface (node:readline:212:10)
at xt (file:///Users/ash_default_agent/.nvm/versions/node/v24.13.0/lib/node_modules/openclaw/node_modules/@clack/core/dist/index.mjs:10:395)
at Object.T [as start] (file:///Users/ash_default_agent/.nvm/versions/node/v24.13.0/lib/node_modules/openclaw/node_modules/@clack/prompts/dist/index.mjs:86:241)
at start (file:///Users/ash_default_agent/.nvm/versions/node/v24.13.0/lib/node_modules/openclaw/dist/cli/progress.js:108:18)
at createCliProgress (file:///Users/ash_default_agent/.nvm/versions/node/v24.13.0/lib/node_modules/openclaw/dist/cli/progress.js:113:9)
at withProgress (file:///Users/ash_default_agent/.nvm/versions/node/v24.13.0/lib/node_modules/openclaw/dist/cli/progress.js:159:22)




[openclaw] Failed to respawn CLI: PolicyDeniedError: No matching allow policy
at ChildProcessInterceptor.syncPolicyCheck (/opt/agenshield/lib/interceptor/register.cjs:861:15)
at interceptedSpawn (/opt/agenshield/lib/interceptor/register.cjs:1028:29)
at ensureExperimentalWarningSuppressed (file:///Users/ash_default_agent/.nvm/versions/node/v24.13.0/lib/node_modules/openclaw/dist/entry.js:36:19)
at file:///Users/ash_default_agent/.nvm/versions/node/v24.13.0/lib/node_modules/openclaw/dist/entry.js:118:6
at ModuleJob.run (node:internal/modules/esm/module_job:413:25)
at process.processTicksAndRejections (node:internal/process/task_queues:103:5)
at async onImport.tracePromise.__proto__ (node:internal/modules/esm/loader:660:26)
at async file:///Users/ash_default_agent/.nvm/versions/node/v24.13.0/lib/node_modules/openclaw/openclaw.mjs:14:1

[openclaw] Failed to respawn CLI: PolicyDeniedError: No matching allow policy
at ChildProcessInterceptor.syncPolicyCheck (/opt/agenshield/lib/interceptor/register.cjs:861:15)
at interceptedSpawn (/opt/agenshield/lib/interceptor/register.cjs:1028:29)
at ensureExperimentalWarningSuppressed (file:///Users/ash_default_agent/.nvm/versions/node/v24.13.0/lib/node_modules/openclaw/dist/entry.js:36:19)
at file:///Users/ash_default_agent/.nvm/versions/node/v24.13.0/lib/node_modules/openclaw/dist/entry.js:118:6
at ModuleJob.run (node:internal/modules/esm/module_job:413:25)
at process.processTicksAndRejections (node:internal/process/task_queues:103:5)
at async onImport.tracePromise.__proto__ (node:internal/modules/esm/loader:660:26)
at async file:///Users/ash_default_agent/.nvm/versions/node/v24.13.0/lib/node_modules/openclaw/openclaw.mjs:14:1


16:12:00 [canvas] host mounted at http://0.0.0.0:18789/__openclaw__/canvas/ (root /Users/ash_default_agent/.openclaw/canvas)
16:12:00 Gateway failed to start: failed to bind gateway socket on ws://0.0.0.0:18789: Error: listen EPERM: operation not permitted 0.0.0.0:18789
