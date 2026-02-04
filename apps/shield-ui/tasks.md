# AgentShield UI - Implementation Tasks

> Progress tracking for the Policy Management & Skill Scanner UI
> Builds on existing codebase - no files deleted, only extended/refactored

## Status Legend
- [ ] Not started
- [~] In progress
- [x] Completed
- [!] Blocked

---

## Phase 1: Foundation

### 1.1 Dependencies
- [ ] Add to package.json: lucide-react, recharts, react-markdown, zustand, date-fns
- [ ] Remove @mui/icons-material from package.json
- [ ] Run install

### 1.2 Styling Infrastructure
- [ ] Create `src/styles/styled.ts` - styled$() utility with name/slot/shouldForwardProp
- [ ] Create `src/styles/tokens.ts` - design tokens (spacing, shadows, layout constants, transitions)
- [ ] Extend `src/theme.ts` with component overrides for new styled components

### 1.3 State Management (Zustand)
- [ ] Create `src/state/events.ts` - EventStore
  - events array (max 1000), connected flag
  - addEvent(), clearEvents(), getByType(), getRecent()
  - apiTrafficMetrics() computed helper
- [ ] Create `src/state/ui.ts` - UIStore
  - selectedPolicyId, selectedSkillName
  - sidebarCollapsed, detailPanelOpen

### 1.4 SSE Client
- [ ] Create `src/api/sse.ts` - SSEClient class
  - connect() with auto-reconnection (max 5 attempts, exponential backoff)
  - disconnect() cleanup
  - Event parsing with type validation
- [ ] Create `src/hooks/useSSE.ts` - React hook wrapper
  - Connect on mount, disconnect on unmount
  - Pipe events to Zustand EventStore
  - Invalidate React Query cache on config:changed events
  - Return { connected, error }

### 1.5 Icon Migration
- [ ] Replace all @mui/icons-material imports with lucide-react in:
  - [ ] `src/components/layout/Header.tsx`
  - [ ] `src/components/layout/Sidebar.tsx`
  - [ ] `src/components/LockBanner.tsx`
  - [ ] `src/components/PasscodeDialog.tsx`
  - [ ] `src/pages/Dashboard.tsx`
  - [ ] `src/pages/Policies.tsx`
  - [ ] `src/pages/Settings.tsx`

---

## Phase 2: Shared Components

### 2.1 PageHeader
- [ ] Create `src/components/shared/PageHeader/`
  - PageHeader.tsx - title, subtitle, actions slot
  - PageHeader.types.ts
  - PageHeader.styles.ts (styled components with name/slot)

### 2.2 Card
- [ ] Create `src/components/shared/Card/`
  - Card.tsx - title, subtitle, icon, actions, variant (default/outlined/elevated), selected, onClick
  - Card.types.ts
  - Card.styles.ts

### 2.3 StatusBadge
- [ ] Create `src/components/shared/StatusBadge/`
  - StatusBadge.tsx - variant (success/warning/error/info/neutral), size, pulse, icon
  - StatusBadge.types.ts
  - StatusBadge.styles.ts (with pulse keyframe animation)

### 2.4 SidePanel
- [ ] Create `src/components/shared/SidePanel/`
  - SidePanel.tsx - open, onClose, title, width, actions slot, showBackdrop
  - SidePanel.types.ts
  - SidePanel.styles.ts (slide-in animation)

### 2.5 SearchInput
- [ ] Create `src/components/shared/SearchInput/`
  - SearchInput.tsx - value, onChange, debounceMs, clearable, placeholder
  - SearchInput.types.ts
  - SearchInput.styles.ts

### 2.6 EmptyState
- [ ] Create `src/components/shared/EmptyState/`
  - EmptyState.tsx - title, description, icon, action button
  - EmptyState.types.ts
  - EmptyState.styles.ts

### 2.7 ConfirmDialog
- [ ] Create `src/components/shared/ConfirmDialog/`
  - ConfirmDialog.tsx - open, title, message, variant (default/danger), onConfirm, onCancel
  - ConfirmDialog.types.ts
  - ConfirmDialog.styles.ts

### 2.8 MarkdownViewer
- [ ] Create `src/components/shared/MarkdownViewer/`
  - MarkdownViewer.tsx - content, maxHeight (uses react-markdown)
  - MarkdownViewer.types.ts
  - MarkdownViewer.styles.ts (prose styles for h1-h6, code, pre, lists, tables, links)

---

## Phase 3: Layout Refactoring

### 3.1 Sidebar
- [ ] Refactor `src/components/layout/Sidebar.tsx`
  - Make persistent (not temporary drawer)
  - Add navigation items: Overview, Skills, Policies, Secrets, Settings
  - Use lucide-react icons (LayoutDashboard, Zap, Shield, Key, Settings)
  - Active item highlighting
  - Collapsible support

### 3.2 Layout
- [ ] Refactor `src/components/layout/Layout.tsx`
  - Support persistent sidebar with margin offset
  - Smooth transition on sidebar collapse

### 3.3 Header
- [ ] Refactor `src/components/layout/Header.tsx`
  - Add SSE connection status indicator (green dot / red dot)
  - Keep existing status chip
  - Keep dark mode toggle
  - Replace MUI icons with lucide-react

---

## Phase 4: Overview Page (Enhances existing Dashboard)

### 4.1 Stats Components
- [ ] Create `src/components/overview/StatsRow/`
  - StatsRow.tsx - Reuse/enhance existing StatCard from Dashboard.tsx
  - Add: Security Level card, Requests Today card
  - Keep: Status, Uptime, PID, Active Policies cards

### 4.2 Traffic Chart
- [ ] Create `src/components/overview/TrafficChart/`
  - TrafficChart.tsx - Recharts AreaChart/LineChart
  - Time range selector (1h, 6h, 24h, 7d)
  - Data from SSE api:request events (requests/time, status codes)
  - TrafficChart.types.ts
  - TrafficChart.styles.ts

### 4.3 Activity Feed
- [ ] Create `src/components/overview/ActivityFeed/`
  - ActivityFeed.tsx - Real-time event list from Zustand EventStore
  - Event type icons and colors
  - Timestamp formatting with date-fns
  - ActivityFeed.types.ts
  - ActivityFeed.styles.ts

### 4.4 Security Status
- [ ] Create `src/components/overview/SecurityStatus/`
  - SecurityStatus.tsx - security level badge, check items list
  - Compact mode for card display
  - SecurityStatus.types.ts
  - SecurityStatus.styles.ts

### 4.5 Page Assembly
- [ ] Create `src/pages/Overview.tsx`
  - Grid layout: stats row → chart + activity feed → daemon info
  - Connect useSSE() hook for real-time updates
  - Keep formatUptime() and daemon info section from Dashboard.tsx
  - Wire TrafficChart to EventStore
  - Wire ActivityFeed to EventStore

---

## Phase 5: Skills Page (NEW)

### 5.1 SkillCard
- [ ] Create `src/components/skills/SkillCard/`
  - SkillCard.tsx - skill name, description, source, status badge
  - Selected state with border highlight
  - SkillCard.types.ts
  - SkillCard.styles.ts

### 5.2 SkillsList
- [ ] Create `src/components/skills/SkillsList/`
  - SkillsList.tsx - scrollable list of SkillCards
  - Group by source (User / Workspace / Quarantine)
  - SkillsList.types.ts
  - SkillsList.styles.ts

### 5.3 SkillDetails
- [ ] Create `src/components/skills/SkillDetails/`
  - SkillDetails.tsx - skill info header + MarkdownViewer for content
  - Actions: Activate, Quarantine, Enable/Disable
  - SkillDetails.types.ts
  - SkillDetails.styles.ts

### 5.4 Page Assembly
- [ ] Create `src/pages/Skills.tsx`
  - Split layout: list (left) + SidePanel detail (right)
  - SearchInput with status filter (Active/Workspace/Quarantined/Disabled)
  - Skills grouped by source
  - MarkdownViewer for selected skill content
  - EmptyState when no skill selected

---

## Phase 6: Policies Page Refactor

### 6.1 PolicyCard
- [ ] Create `src/components/policies/PolicyCard/`
  - PolicyCard.tsx - name, type indicator (allowlist=green/denylist=red), pattern count, enabled toggle
  - Selected state
  - PolicyCard.types.ts
  - PolicyCard.styles.ts

### 6.2 PolicyGrid
- [ ] Create `src/components/policies/PolicyGrid/`
  - PolicyGrid.tsx - responsive grid (3 cols default, 1 col when selection active)
  - Grid → list transition animation
  - PolicyGrid.types.ts
  - PolicyGrid.styles.ts

### 6.3 PolicyEditor
- [ ] Create `src/components/policies/PolicyEditor/`
  - PolicyEditor.tsx - form for create/edit (preserve existing form logic)
  - Name, Type, Patterns textarea, Enabled toggle
  - Save/Cancel actions
  - PolicyEditor.types.ts
  - PolicyEditor.styles.ts

### 6.4 Page Refactor
- [ ] Refactor `src/pages/Policies.tsx`
  - Replace table with PolicyGrid
  - Add SidePanel for PolicyEditor on selection
  - Grid collapses to single column when policy selected
  - Preserve all existing CRUD operations
  - Preserve existing add/edit dialog form logic
  - Add PageHeader with "Create Policy" action button

---

## Phase 7: Secrets Page (NEW)

### 7.1 SecretTypeSelector
- [ ] Create `src/components/secrets/SecretTypeSelector/`
  - SecretTypeSelector.tsx - Global/Command/URL/Skill toggle buttons
  - Icons: Globe, Terminal, Link, Zap (lucide-react)
  - SecretTypeSelector.types.ts
  - SecretTypeSelector.styles.ts

### 7.2 SecretForm
- [ ] Create `src/components/secrets/SecretForm/`
  - SecretForm.tsx - dialog form for add/edit
  - Fields: name, value (masked), scope type, pattern (conditional)
  - Dynamic fields based on scope:
    - Global: no extra fields
    - Command: command pattern input (e.g., "psql*", "aws s3*")
    - URL: endpoint pattern input (e.g., "api.example.com/*")
    - Skill: skill selector dropdown (from loaded skills)
  - SecretForm.types.ts
  - SecretForm.styles.ts

### 7.3 SecretsList
- [ ] Create `src/components/secrets/SecretsList/`
  - SecretsList.tsx - list with masked values, scope icons, actions
  - Actions: view (toggle mask), copy, delete
  - Grouped by scope type
  - SecretsList.types.ts
  - SecretsList.styles.ts

### 7.4 Page Assembly
- [ ] Create `src/pages/Secrets.tsx`
  - PageHeader with "Add Secret" button
  - SecretTypeSelector as filter
  - SearchInput
  - SecretsList
  - Dialog for SecretForm (create/edit)
  - ConfirmDialog for delete confirmation
  - EmptyState when no secrets

---

## Phase 8: Daemon API Extensions

### 8.1 Skills Routes
- [ ] Create `libs/shield-daemon/src/routes/skills.ts`
  - GET /api/skills - scan and list skills from all sources with status
  - GET /api/skills/:name - get skill detail with markdown content
  - PUT /api/skills/:name/toggle - enable/disable
  - POST /api/skills/:name/activate - move from quarantine to active
  - POST /api/skills/:name/quarantine - move to quarantine
- [ ] Implement skill source scanning:
  - ~/.openclaw/skills (user-level, active)
  - workspace/.openclaw/skills (workspace-level)
  - ~/.agenshield/skills/quarantine (quarantined)
- [ ] Register routes in `libs/shield-daemon/src/routes/index.ts`

### 8.2 Secrets Routes
- [ ] Create `libs/shield-daemon/src/routes/secrets.ts`
  - GET /api/secrets - list secrets with masked values
  - POST /api/secrets - create secret with scope:
    - global scope
    - command scope with pattern
    - url scope with pattern
    - skill scope with skillId
  - DELETE /api/secrets/:id - delete secret
- [ ] Add types to `libs/shield-ipc/src/types/config.ts`
  - SecretScope union type
  - Secret interface
- [ ] Register routes

### 8.3 Policy Routes Enhancement
- [ ] Create `libs/shield-daemon/src/routes/policies.ts`
  - GET /api/policies - list all policies
  - POST /api/policies - create policy
  - PUT /api/policies/:id - update policy
  - DELETE /api/policies/:id - delete policy
- [ ] Register routes

---

## Phase 9: API Client & Hooks

### 9.1 Extend API Client
- [ ] Add to `src/api/client.ts`:
  - getSecurity() → SecurityStatus
  - getSkills() → SkillSummary[]
  - getSkill(name) → SkillDetail
  - toggleSkill(name, enabled) → SkillDetail
  - activateSkill(name) → response
  - quarantineSkill(name) → response
  - getSecrets() → Secret[]
  - createSecret(data) → Secret
  - deleteSecret(id) → response
  - getPolicies() → PolicyConfig[]
  - createPolicy(data) → PolicyConfig
  - updatePolicy(id, data) → PolicyConfig
  - deletePolicy(id) → response

### 9.2 Add React Query Hooks
- [ ] Add to `src/api/hooks.ts`:
  - useSecurity() - refetch every 10s
  - useSkills()
  - useSkill(name)
  - useToggleSkill()
  - useActivateSkill()
  - useQuarantineSkill()
  - useSecrets()
  - useCreateSecret()
  - useDeleteSecret()
  - usePolicies()
  - useCreatePolicy()
  - useUpdatePolicy()
  - useDeletePolicy()

---

## Phase 10: App Integration

### 10.1 Router Updates
- [ ] Update `src/App.tsx`:
  - Change `/` route from Dashboard → Overview
  - Add `/skills` route → Skills page
  - Keep `/policies` route → Policies page (refactored)
  - Add `/secrets` route → Secrets page
  - Keep `/settings` route → Settings page
  - Initialize SSE connection in AppContent

### 10.2 Sidebar Navigation
- [ ] Verify Sidebar shows all nav items:
  - Overview (LayoutDashboard icon) → /
  - Skills (Zap icon) → /skills
  - Policies (Shield icon) → /policies
  - Secrets (Key icon) → /secrets
  - Settings (Settings icon) → /settings

---

## Phase 11: Polish & Production Readiness

### 11.1 Error Handling
- [ ] Add ErrorBoundary component wrapping pages
- [ ] Add error states for failed data fetches
- [ ] Add toast/snackbar notifications for mutations
- [ ] Handle SSE disconnection gracefully (reconnect banner)

### 11.2 Loading States
- [ ] Add skeleton loaders for cards and grids
- [ ] Add loading indicators for mutations
- [ ] Add connection status indicator in header (green/red dot)

### 11.3 Accessibility
- [ ] Add ARIA labels to all interactive elements
- [ ] Keyboard navigation for skill/policy lists
- [ ] Focus management for dialogs and panels
- [ ] Screen reader announcements for live updates

### 11.4 Performance
- [ ] Memoize expensive computations (useMemo/useCallback)
- [ ] Virtualize ActivityFeed for large event lists
- [ ] Lazy load pages with React.lazy() + Suspense
- [ ] Debounce search inputs

### 11.5 Final Cleanup
- [ ] Verify no inline styles remain
- [ ] Verify all icons are lucide-react
- [ ] Verify all components follow folder convention
- [ ] Verify no @mui/icons-material imports
- [ ] Remove unused Dashboard.tsx (merged into Overview.tsx)

---

## Dependencies

| Package | Purpose |
|---------|---------|
| lucide-react | Icons (replaces @mui/icons-material) |
| recharts | Traffic/stats charts |
| react-markdown | Skill markdown rendering |
| zustand | Client state (SSE events, UI prefs) |
| date-fns | Date/time formatting |

---

## File Creation Order

1. `src/styles/styled.ts` + `src/styles/tokens.ts`
2. `src/state/events.ts` + `src/state/ui.ts`
3. `src/api/sse.ts` + `src/hooks/useSSE.ts`
4. Icon migration (lucide-react)
5. Shared components (PageHeader, Card, StatusBadge, SidePanel, etc.)
6. Layout refactoring (Sidebar, Layout, Header)
7. Overview page + components
8. Skills page + components
9. Policies refactor + components
10. Secrets page + components
11. Daemon routes (skills, secrets, policies)
12. API client + hooks extensions
13. App.tsx integration
14. Polish pass

---

## Preserved Functionality (DO NOT BREAK)

- **Auth flow**: AuthContext, PasscodeDialog (unlock + setup), LockBanner, token refresh
- **Settings page**: Form with change tracking, save/reset
- **Dark mode**: System preference detection, toggle
- **Status polling**: useStatus (5s), useHealth (30s)
- **Error handling**: Existing alert patterns in Settings/Policies
