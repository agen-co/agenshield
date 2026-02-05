# Marketplace Backend Implementation Instructions

This document describes the backend changes required to support the marketplace skill browsing and installation feature. The UI has already been implemented and expects these API endpoints.

---

## Overview

The marketplace feature allows users to:
1. **Search** for skills on the ClawHub marketplace
2. **View** skill details (README, files, metadata)
3. **Analyze** skill files for vulnerabilities via `https://agen.co/analyze/skill`
4. **Install** marketplace skills locally

All marketplace API calls from the UI go through the daemon, which proxies them to external services.

---

## Routes to Add

**File:** `libs/shield-daemon/src/routes/marketplace.ts`

| Method | Path | Description |
|--------|------|-------------|
| GET | `/marketplace/search?q=keyword` | Proxy search to ClawHub |
| GET | `/marketplace/skills/:slug` | Proxy skill detail to ClawHub |
| POST | `/marketplace/analyze` | Proxy analyze to agen.co |
| POST | `/marketplace/install` | Write skill files locally + approve |

### Route Implementation Details

#### GET `/marketplace/search?q=keyword`
- Extract `q` query parameter
- Call `MarketplaceService.searchMarketplace(q)`
- Return `{ data: MarketplaceSkill[] }`

#### GET `/marketplace/skills/:slug`
- Extract `slug` from route params
- Call `MarketplaceService.getMarketplaceSkill(slug)`
- Return `{ data: MarketplaceSkill }`

#### POST `/marketplace/analyze`
- Accept body: `{ files: MarketplaceSkillFile[] }`
- Call `MarketplaceService.analyzeSkillBundle(files)`
- Return `{ data: AnalyzeSkillResponse }`

#### POST `/marketplace/install`
- Accept body: `{ slug: string, files: MarketplaceSkillFile[], analysis: Analysis }`
- Validate analysis exists and vulnerability level is not `critical`
- Write files to `~/.openclaw/skills/<slug>/`
- Run local analysis via `analyzeSkill()` from `services/skill-analyzer.ts`
- Call `approveSkill()` from `watchers/skills.ts`
- Return `{ data: { success: true, name: slug } }`

---

## Service to Add

**File:** `libs/shield-daemon/src/services/marketplace.ts`

### `searchMarketplace(query: string)`
- **External call:** `GET https://clawhub.ai/api/v1/skills?q={query}`
- **Cache:** In-memory Map, 60-second TTL keyed by query string
- **Timeout:** `AbortSignal.timeout(10_000)`
- **Error handling:** Return HTTP 502 on upstream failure

### `getMarketplaceSkill(slug: string)`
- **External call:** `GET https://clawhub.ai/api/v1/skills/{slug}`
- **Cache:** In-memory Map, 5-minute TTL keyed by slug
- **Timeout:** `AbortSignal.timeout(10_000)`
- **Error handling:** Return HTTP 502 on upstream failure

### `analyzeSkillBundle(files: MarketplaceSkillFile[])`
- **External call:** `POST https://agen.co/analyze/skill`
- **Body:** `{ files: [...] }`
- **Cache:** Not cached (one-shot operation)
- **Timeout:** `AbortSignal.timeout(30_000)`
- **Error handling:** Return HTTP 502 on upstream failure

---

## IPC Types to Add

**File:** `libs/shield-ipc/src/types/marketplace.ts`

```typescript
export interface MarketplaceSkill {
  name: string;
  slug: string;
  description: string;
  author: string;
  version: string;
  installs: number;
  tags: string[];
  readme?: string;
  files?: MarketplaceSkillFile[];
}

export interface MarketplaceSkillFile {
  name: string;     // e.g. "SKILL.md", "index.ts"
  type: string;     // e.g. "markdown", "typescript"
  content: string;
  purpose?: string;
}

export interface AnalyzeSkillRequest {
  files: MarketplaceSkillFile[];
}

export interface AnalyzeSkillResponse {
  analysis: {
    status: 'complete' | 'error';
    vulnerability: {
      level: 'safe' | 'low' | 'medium' | 'high' | 'critical';
      details: string[];
      suggestions?: string[];
    };
    commands: Array<{
      name: string;
      source: string;
      available: boolean;
      resolvedPath?: string;
      required: boolean;
    }>;
  };
}

export interface InstallSkillRequest {
  slug: string;
  files: MarketplaceSkillFile[];
  analysis: AnalyzeSkillResponse['analysis'];
}
```

---

## Route Registration

**File:** `libs/shield-daemon/src/routes/index.ts`

- Import `marketplaceRoutes` from `./marketplace`
- Register with `api.register(marketplaceRoutes)`

Follow the same registration pattern used by existing route modules.

---

## Cache Strategy

| Data | TTL | Storage |
|------|-----|---------|
| Search results | 60 seconds | In-memory `Map<string, { data, expiry }>` |
| Skill detail | 5 minutes | In-memory `Map<string, { data, expiry }>` |
| Analysis | Not cached | One-shot POST |

Example cache implementation:

```typescript
const cache = new Map<string, { data: unknown; expiry: number }>();

function getCached<T>(key: string): T | null {
  const entry = cache.get(key);
  if (!entry || Date.now() > entry.expiry) {
    cache.delete(key);
    return null;
  }
  return entry.data as T;
}

function setCache(key: string, data: unknown, ttlMs: number): void {
  cache.set(key, { data, expiry: Date.now() + ttlMs });
}
```

---

## Error Handling

- All external calls must use `AbortSignal.timeout()`:
  - 10 seconds for search and skill detail
  - 30 seconds for analysis
- On upstream failure (network error, non-2xx response, timeout), return **HTTP 502** with:
  ```json
  { "error": "Upstream service unavailable" }
  ```

---

## Install Flow (Detailed)

The `/marketplace/install` endpoint performs these steps in order:

1. **Validate** the request body contains `slug`, `files`, and `analysis`
2. **Check** that `analysis.vulnerability.level` is not `critical` — if it is, return 400
3. **Write files** to `~/.openclaw/skills/<slug>/`:
   - Create the directory if it doesn't exist
   - Write each file from `files` array using `name` as filename and `content` as file content
4. **Run local analysis** via the existing `analyzeSkill()` function from `services/skill-analyzer.ts`
5. **Approve skill** via the existing `approveSkill()` function from `watchers/skills.ts`
6. **Return** `{ data: { success: true, name: slug } }`

If any step fails, clean up written files and return an appropriate error.

---

## Testing

After implementing, verify:

1. `GET /marketplace/search?q=test` proxies to ClawHub and returns skill list
2. `GET /marketplace/skills/some-slug` returns skill detail with files and readme
3. `POST /marketplace/analyze` with files body proxies to agen.co and returns analysis
4. `POST /marketplace/install` writes files, analyzes, and approves the skill
5. Cache works correctly (second identical search within 60s doesn't call ClawHub)
6. Timeouts trigger 502 responses
7. Critical vulnerability level blocks installation with 400
