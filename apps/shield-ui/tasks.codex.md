# AgenShield Shield UI (Policy Management + Skill Scanner) — Detailed Plan

## Decisions (from user)
- SSE: use current endpoints from repo (`/sse/events`, `/sse/events/security`, `/sse/events/api`, `/sse/events/broker`).
- Auth/write unlock: use daemon endpoint + header returned when opening SSE (store header/session for write calls).
- No MUI MCP lookup; use old dashboard patterns only.

## Known gaps (must be clarified during implementation)
- Exact passcode endpoint + header name/type (cookie vs header), and how to read/retain it from SSE.
- Skills and secrets API endpoints + payloads (not present in current daemon routes).
- Folder-access enablement API (location in config or dedicated endpoint).

---

## 0) Repo scan + contracts (no code changes)
- [ ] Confirm current daemon API routes in `libs/shield-daemon/src/routes`.
- [ ] Confirm IPC event types in `libs/shield-ipc/src/types/events.ts` and map them to UI needs.
- [ ] Identify any existing types for skills/secrets/vault in `libs/shield-ipc/src/types`.
- [ ] Document required backend endpoints missing from daemon (skills, secrets, passcode unlock, folder access).

## 1) Target folder structure (all inside `apps/shield-ui/src`)
- [ ] Create folder-based architecture (no `modules/`):
  - `api/` (client, endpoints, sse)
  - `components/` (single folder for all shared components)
  - `layouts/` (AppShell, panels)
  - `pages/` (Overview, Skills, Policies, Secrets)
  - `state/` (event store, auth/write state)
  - `utils/` (formatters, guards, mapping)
- [ ] Flatten existing `components/layout/*` into `components/` or `layouts/` (one shared folder).
- [ ] Remove inline styles (`sx`, `style`) and replace with `styled` components.

## 2) Theme + design tokens
- [ ] Define `theme.ts` tokens (palette, typography, spacing, radii, shadows).
- [ ] Add styled helpers for common layout primitives (stack, grid, panel, divider).
- [ ] Replace MUI icon usage with `lucide-react` mapping.

## 3) Router + guards (patterned after old dashboard)
- [ ] Implement `createBrowserRouter` with a root layout and nested routes.
- [ ] Add guard/hook to enforce read-only vs write unlock state.
- [ ] Create route metadata for layout needs (e.g., noScroll, noPadding).

## 4) Auth/write unlock flow (passcode)
- [ ] Add passcode modal/inline prompt with masked input.
- [ ] Add `api/auth` client method to call daemon passcode endpoint.
- [ ] Store auth header/session token in memory (optional sessionStorage).
- [ ] Attach auth header to all write requests (PUT/POST/DELETE).
- [ ] Handle 401/403 by reverting to read-only + show locked banner.
- [ ] SSE handshake: open SSE connection after passcode success; capture session header/cookie if provided.
- [ ] Document limitations (EventSource cannot set custom headers; use cookie or query string if needed).

## 5) SSE + event store
- [ ] Create `sse.ts` with EventSource setup for `/sse/events` + filters.
- [ ] Implement reconnection with backoff + heartbeat handling.
- [ ] Parse and normalize events (`security:*`, `api:*`, `broker:*`, `config:changed`, `heartbeat`).
- [ ] Maintain capped event history (e.g., last 200) for “last actions.”
- [ ] Build derived metrics for traffic charts (per-minute counts, status buckets, latency stats).
- [ ] Invalidate React Query caches when `config:changed` arrives.

## 6) Shared components (all in `components/`)
- [ ] `AppShell` parts: `TopBar`, `PrimaryNav`, `SecondaryNav` (Skills/Policies/Secrets), `ContentArea`.
- [ ] `PageHeader` with title, description, action slot.
- [ ] `StatCard`, `InfoCard`, `AlertBanner`, `EmptyState`, `LoadingState`.
- [ ] `SplitPanel` + `DetailPanel` (right-side drawer/panel).
- [ ] `SelectableList` + `CardGrid` for skills/policies.
- [ ] `MarkdownViewer` (react-markdown + GFM + sanitize).
- [ ] `LockBanner` + `UnlockButton` for read-only/write states.
- [ ] `FormField`, `SelectField`, `ToggleField` for consistent forms.

## 7) Overview page (Recharts)
- [ ] Layout: header + stats row + charts + last actions feed.
- [ ] Stats: daemon running, uptime, version, port, active policies, security level.
- [ ] Charts (Recharts):
  - API requests over time (line/area)
  - Status code distribution (bar)
  - Latency trend (line)
- [ ] “Last actions” list from SSE (api/broker/config/security).
- [ ] Empty/error states for missing SSE/daemon offline.

## 8) Skills page
- [ ] API: fetch active skills list + metadata + markdown content.
- [ ] Left panel: searchable list with status chips.
- [ ] Right panel: markdown details for selected skill.
- [ ] Actions (passcode-gated): enable/disable, add skill (if supported).
- [ ] Add skeleton loading and empty list UX.

## 9) Policies page
- [ ] API: fetch policies list; write operations for add/edit/delete.
- [ ] Default view: grid of policy cards with type/priority/status.
- [ ] On select: transition to split view (left single-column list + right detail panel).
- [ ] Detail panel: rules, operations, patterns, last updated, enable/disable.
- [ ] Edit/create form: validated, optimistic update + rollback on error.
- [ ] Confirm delete flow with warning and undo (if possible).

## 10) Secrets page
- [ ] API: fetch secrets list (global/command/url scope) + metadata (last used).
- [ ] Add secret form with explicit “how added” selector:
  - Global secret
  - Command-scoped (bash command)
  - URL-scoped (curl/fetch)
- [ ] Mask secret values by default; reveal toggle.
- [ ] Edit/delete (passcode-gated) with audit/confirm dialog.
- [ ] Display “how added” in list cards and detail panel.

## 11) Folder access controls
- [ ] Add “Folder Access” section (location TBD: Policies or Overview).
- [ ] Read current allowlist/paths from daemon config (if exists).
- [ ] Add enable/disable + add/remove paths (passcode-gated).

## 12) Error handling + production readiness
- [ ] Global error boundary for API failures.
- [ ] SSE disconnect banner with retry + last-connected timestamp.
- [ ] Cap event list memory and chart dataset sizes.
- [ ] Accessibility pass (keyboard nav, focus rings, aria for charts).
- [ ] Performance pass (memoized charts, list virtualization if needed).
- [ ] Build output check: daemon static assets path + base routing.

## 13) Validation checklist
- [ ] Read-only mode works without passcode.
- [ ] Passcode unlock enables write actions + persists for session.
- [ ] SSE events update UI in real time (actions + charts).
- [ ] Policies/skills/secrets flows match expected API behavior.
- [ ] All icons from `lucide-react`.
- [ ] No inline styles; all styling via `styled` components.

---

## Backend/API dependencies to confirm
- Passcode endpoint path + header/cookie name and TTL.
- Skills endpoints (list + details + enable/disable + add).
- Secrets endpoints (list + add + delete + scope).
- Folder access endpoint/shape.
- Whether `/api/config` remains the write source for policies or move to `/api/policies`.

