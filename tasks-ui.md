# AgenShield UI & Daemon - Task Specification

## Overview
This document specifies the tasks for creating the UI dashboard and daemon HTTP server components of AgenShield.

**Related work (separate agent):**
- CLI commands (start, stop, status, setup)
- Socket broker between OpenClaw and root user
- Installation scripts

---

## Task Groups

### Group 1: IPC Library (`libs/shield-ipc`)

#### Task 1.1: Create library scaffolding
**Files to create:**
- `libs/shield-ipc/project.json`
- `libs/shield-ipc/package.json`
- `libs/shield-ipc/tsconfig.json`
- `libs/shield-ipc/tsconfig.lib.json`
- `libs/shield-ipc/eslint.config.mjs`
- `libs/shield-ipc/src/index.ts`

**Config updates:**
- `tsconfig.base.json` - Add path alias `@agen-co/shield-ipc`

**Dependencies:**
- `zod: ^3.23.0`

#### Task 1.2: Define configuration types
**File:** `libs/shield-ipc/src/types/config.ts`
```typescript
export interface ShieldConfig {
  version: string;
  daemon: DaemonConfig;
  policies: PolicyConfig[];
  vault?: VaultConfig;
}

export interface DaemonConfig {
  port: number;           // Default: 5200
  host: string;           // Default: 'localhost'
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  enableHostsEntry: boolean;
}

export interface PolicyConfig {
  id: string;
  name: string;
  type: 'allowlist' | 'denylist';
  patterns: string[];
  enabled: boolean;
}

export interface VaultConfig {
  enabled: boolean;
  provider: 'local' | 'env';
}
```

#### Task 1.3: Define daemon status types
**File:** `libs/shield-ipc/src/types/daemon.ts`
```typescript
export interface DaemonStatus {
  running: boolean;
  pid?: number;
  uptime?: number;
  version: string;
  port: number;
  startedAt?: string;
}
```

#### Task 1.4: Define API types
**File:** `libs/shield-ipc/src/types/api.ts`
```typescript
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: ApiError;
}

export interface ApiError {
  code: string;
  message: string;
  details?: unknown;
}

// Response types
export type GetStatusResponse = ApiResponse<DaemonStatus>;
export type GetConfigResponse = ApiResponse<ShieldConfig>;
export type UpdateConfigResponse = ApiResponse<ShieldConfig>;
export type HealthResponse = ApiResponse<{ ok: boolean; timestamp: string }>;

// Request types
export type UpdateConfigRequest = Partial<ShieldConfig>;
```

#### Task 1.5: Define constants
**File:** `libs/shield-ipc/src/constants.ts`
```typescript
export const DEFAULT_PORT = 5200;
export const DEFAULT_HOST = 'localhost';
export const CUSTOM_HOSTNAME = 'agen.shield';

// Paths relative to user home directory
export const CONFIG_DIR = '.agenshield';
export const CONFIG_FILE = 'config.json';
export const PID_FILE = 'daemon.pid';
export const LOG_FILE = 'daemon.log';

// API Endpoints
export const API_PREFIX = '/api';
export const ENDPOINTS = {
  HEALTH: '/health',
  STATUS: '/status',
  CONFIG: '/config',
  POLICIES: '/policies',
} as const;
```

#### Task 1.6: Create Zod schemas
**File:** `libs/shield-ipc/src/schemas/config.schema.ts`
```typescript
import { z } from 'zod';

export const DaemonConfigSchema = z.object({
  port: z.number().min(1).max(65535).default(5200),
  host: z.string().default('localhost'),
  logLevel: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  enableHostsEntry: z.boolean().default(false),
});

export const PolicyConfigSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(100),
  type: z.enum(['allowlist', 'denylist']),
  patterns: z.array(z.string()),
  enabled: z.boolean().default(true),
});

export const ShieldConfigSchema = z.object({
  version: z.string(),
  daemon: DaemonConfigSchema,
  policies: z.array(PolicyConfigSchema).default([]),
  vault: z.object({
    enabled: z.boolean(),
    provider: z.enum(['local', 'env']),
  }).optional(),
});
```

#### Task 1.7: Create index exports
**File:** `libs/shield-ipc/src/index.ts`
- Re-export all types from `./types/*`
- Re-export all schemas from `./schemas/*`
- Re-export constants from `./constants`

---

### Group 2: UI Application (`apps/shield-ui`)

#### Task 2.1: Create app scaffolding
**Files to create:**
- `apps/shield-ui/project.json`
- `apps/shield-ui/package.json`
- `apps/shield-ui/tsconfig.json`
- `apps/shield-ui/tsconfig.app.json`
- `apps/shield-ui/vite.config.ts`
- `apps/shield-ui/index.html`

**Root config updates:**
- `package.json` - Add `@nx/vite`, `@nx/react` devDeps

**App dependencies:**
```json
{
  "dependencies": {
    "@agen-co/shield-ipc": "workspace:*",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "react-router-dom": "^7.0.0",
    "@tanstack/react-query": "^5.60.0",
    "@mui/material": "^6.4.0",
    "@mui/icons-material": "^6.4.0",
    "@emotion/react": "^11.14.0",
    "@emotion/styled": "^11.14.0"
  },
  "devDependencies": {
    "@vitejs/plugin-react": "^4.3.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "vite": "^6.0.0",
    "typescript": "^5.9.3"
  }
}
```

#### Task 2.2: Create MUI theme
**File:** `apps/shield-ui/src/theme.ts`
- Define custom MUI theme with AgenShield colors
- Dark mode support
- Typography configuration

#### Task 2.3: Create app entry point
**Files:**
- `apps/shield-ui/src/main.tsx` - React entry with providers
- `apps/shield-ui/src/App.tsx` - Root component with router

#### Task 2.4: Create API client
**File:** `apps/shield-ui/src/api/client.ts`
```typescript
const BASE_URL = '/api';

async function request<T>(endpoint: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${endpoint}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) throw new Error(`API Error: ${res.status}`);
  return res.json();
}

export const api = {
  getHealth: () => request<HealthResponse>('/health'),
  getStatus: () => request<GetStatusResponse>('/status'),
  getConfig: () => request<GetConfigResponse>('/config'),
  updateConfig: (data: UpdateConfigRequest) =>
    request<UpdateConfigResponse>('/config', {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
};
```

#### Task 2.5: Create React Query hooks
**File:** `apps/shield-ui/src/api/hooks.ts`
- `useStatus()` - Fetch daemon status
- `useConfig()` - Fetch configuration
- `useUpdateConfig()` - Mutation for config updates

#### Task 2.6: Create layout components
**Files:**
- `apps/shield-ui/src/components/layout/Layout.tsx` - Main layout wrapper
- `apps/shield-ui/src/components/layout/Sidebar.tsx` - Navigation sidebar
- `apps/shield-ui/src/components/layout/Header.tsx` - Top app bar

#### Task 2.7: Create Dashboard page
**File:** `apps/shield-ui/src/pages/Dashboard.tsx`
- Status overview card
- Quick stats (uptime, policies, etc.)
- Recent activity

#### Task 2.8: Create Policies page
**File:** `apps/shield-ui/src/pages/Policies.tsx`
- List of policies
- Add/Edit/Delete policy
- Enable/disable toggle

#### Task 2.9: Create Settings page
**File:** `apps/shield-ui/src/pages/Settings.tsx`
- Daemon configuration form
- Port, host, log level settings
- Hosts entry toggle

---

### Group 3: Daemon Server (`libs/shield/src/daemon/`)

#### Task 3.1: Create Fastify server setup
**File:** `libs/shield/src/daemon/server.ts`
```typescript
import Fastify from 'fastify';
import cors from '@fastify/cors';
import staticPlugin from '@fastify/static';
import { registerRoutes } from './routes';
import { getUiAssetsPath } from './static';

export async function createServer(config: DaemonConfig) {
  const app = Fastify({ logger: true });

  await app.register(cors, { origin: true });
  await registerRoutes(app);

  // Serve static UI assets
  const uiPath = getUiAssetsPath();
  if (uiPath) {
    await app.register(staticPlugin, {
      root: uiPath,
      prefix: '/',
    });
  }

  return app;
}
```

**Dependencies to add to libs/shield:**
```json
{
  "dependencies": {
    "@agen-co/shield-ipc": "workspace:*",
    "fastify": "^5.0.0",
    "@fastify/static": "^8.0.0",
    "@fastify/cors": "^10.0.0"
  }
}
```

#### Task 3.2: Create static asset resolver
**File:** `libs/shield/src/daemon/static.ts`
- Resolve UI assets path (production vs development)
- Handle missing UI assets gracefully

#### Task 3.3: Create health route
**File:** `libs/shield/src/daemon/routes/health.ts`
- `GET /api/health` - Returns `{ ok: true, timestamp }`

#### Task 3.4: Create status route
**File:** `libs/shield/src/daemon/routes/status.ts`
- `GET /api/status` - Returns daemon status (pid, uptime, version)

#### Task 3.5: Create config routes
**File:** `libs/shield/src/daemon/routes/config.ts`
- `GET /api/config` - Returns current configuration
- `PUT /api/config` - Updates configuration

#### Task 3.6: Create route registration
**File:** `libs/shield/src/daemon/routes/index.ts`
- Register all API routes under `/api` prefix

#### Task 3.7: Create config file utilities
**Files:**
- `libs/shield/src/config/paths.ts` - Get config dir, file paths
- `libs/shield/src/config/defaults.ts` - Default configuration
- `libs/shield/src/config/loader.ts` - Load/save config from disk

---

### Group 4: Build Pipeline

#### Task 4.1: Update shield project.json
Add `bundle-ui` target to copy UI assets into shield dist:
```json
{
  "bundle-ui": {
    "executor": "nx:run-commands",
    "dependsOn": ["build-tsc", "shield-ui:build"],
    "options": {
      "commands": [
        "mkdir -p libs/shield/dist/ui-assets",
        "cp -r dist/apps/shield-ui/* libs/shield/dist/ui-assets/"
      ]
    }
  },
  "build": {
    "dependsOn": ["bundle-ui"],
    ...
  }
}
```

#### Task 4.2: Update Vite config for production paths
Ensure `apps/shield-ui/vite.config.ts` outputs to correct location.

---

## Task Summary

| ID | Task | Group | Estimate |
|----|------|-------|----------|
| 1.1 | IPC library scaffolding | IPC | Small |
| 1.2 | Configuration types | IPC | Small |
| 1.3 | Daemon status types | IPC | Small |
| 1.4 | API types | IPC | Small |
| 1.5 | Constants | IPC | Small |
| 1.6 | Zod schemas | IPC | Small |
| 1.7 | Index exports | IPC | Small |
| 2.1 | UI app scaffolding | UI | Medium |
| 2.2 | MUI theme | UI | Small |
| 2.3 | App entry point | UI | Small |
| 2.4 | API client | UI | Small |
| 2.5 | React Query hooks | UI | Small |
| 2.6 | Layout components | UI | Medium |
| 2.7 | Dashboard page | UI | Medium |
| 2.8 | Policies page | UI | Medium |
| 2.9 | Settings page | UI | Medium |
| 3.1 | Fastify server setup | Daemon | Medium |
| 3.2 | Static asset resolver | Daemon | Small |
| 3.3 | Health route | Daemon | Small |
| 3.4 | Status route | Daemon | Small |
| 3.5 | Config routes | Daemon | Small |
| 3.6 | Route registration | Daemon | Small |
| 3.7 | Config utilities | Daemon | Small |
| 4.1 | Shield project.json update | Build | Small |
| 4.2 | Vite config update | Build | Small |

---

## Verification Checklist

- [ ] `npx nx build shield-ipc` compiles successfully
- [ ] `npx nx build shield-ui` builds React app
- [ ] `npx nx build shield` produces dist with embedded UI
- [ ] Starting daemon serves UI at http://localhost:5200
- [ ] API endpoints return expected responses:
  - [ ] `GET /api/health` → `{ success: true, data: { ok: true } }`
  - [ ] `GET /api/status` → Daemon status
  - [ ] `GET /api/config` → Current config
  - [ ] `PUT /api/config` → Updates config
- [ ] UI can fetch and display daemon status
- [ ] UI can view and edit configuration
