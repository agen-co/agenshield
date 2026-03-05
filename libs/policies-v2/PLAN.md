# AgenShield Policies V2 Plan (draft)

## 0) Glossary

* **hostUser**: the interactive user on the machine (your account).
* **agentUser**: the dedicated system user running the AI agent, e.g. `ash_claude_agent`.
* **Sandbox A**: the Seatbelt sandbox for the agent process (Claude Code).
* **Sandbox B**: per‑execution Seatbelt sandbox for each tool/process launched by AgenShield.
* **Broker**: the “performance proxy” responsible for parsing, policy evaluation, dynamic Seatbelt generation, spawning, streaming, artifacts.
* **Supervisor**: lifecycle manager + policy orchestrator + audit + approval router.
* **Policy Graph**: graph of nodes and edges describing *contextual permissions* based on **caller path** (who called whom).

---

# 1) High-level goals and non-negotiable invariants

## 1.1 Goals

* Contain the AI agent inside `agentUser` + Sandbox A.
* Allow work to happen via controlled execution: streaming, pipelines, large files.
* Support “run as hostUser” only via explicit, time‑boxed human approval.
* Provide *contextual* permissions via **Policy Graph**:

  * “`curl` is forbidden generally”
  * “`curl` is allowed only when invoked by `gog`, and only to URL allowlist”
  * “`jira create` injects env; `jira read` does not”

## 1.2 Security invariants

1. **No direct exec escape:** Agent cannot exec arbitrary binaries directly; all meaningful exec happens via Broker.
2. **Default deny:** Policy defaults to deny unless explicitly allowed by a node/edge path.
3. **Context matters:** Permissions are granted based on **caller path**, not just “what command.”
4. **Human‑gated privilege:** Anything that runs as hostUser (or otherwise elevated) requires an approval grant bound to an exact scope (once or TTL).
5. **Trusted computing base stays small:** Supervisor/Broker + host approver/executor are the only privileged components. Wrappers are thin and immutable (or eliminated later).
6. **Auditable:** Every request/decision/spawn/output/artifact/grant is logged with correlation IDs.

---

# 2) Process architecture (what runs where)

## 2.1 Components

### A) Launcher (hostUser)

* Entry point CLI: `agenshield run …`
* Only responsibility: start Supervisor safely (sanitized env, fixed path, strict sudo rule).

### B) Supervisor (runs as `agentUser`, outside Sandbox A)

* Loads policies (graph)
* Starts Broker
* Starts Agent in Sandbox A
* Runs approval router + audit logger
* Manages sessions, job registry, artifact store metadata

### C) Exec Broker (runs with Supervisor)

* Receives structured exec/pipeline requests
* AST parser
* Policy graph evaluation
* Dynamic Seatbelt generation (Sandbox B)
* Spawns processes, wires pipes, streams output
* Handles artifacts (spill large output)
* Issues “caller tokens / capability channels” for nested calls

### D) Agent (Claude Code) inside Sandbox A as `agentUser`

* No direct exec (deny process-exec except very limited if needed)
* Can call Broker over local IPC only

### E) Host Approver + Host Executor (runs as hostUser in GUI session)

* Displays native notifications/popup
* Optionally supports SMS approvals (integration)
* On approval, executes “hostUser jobs” (still under a Sandbox B) and streams back

> Key design: **hostUser execution is performed by a hostUser-owned component**, not by granting `agentUser` the ability to become hostUser.

### F) Optional Network Proxy (local)

* Broker can force “proxy-only networking”
* Proxy enforces host allowlists + audit

---

# 3) The execution contract: everything goes through Broker

## 3.1 Broker API primitives

Minimal streaming-friendly API surface:

1. `Exec(request) -> job_id | needs_approval(request_id)`
2. `Stream(job_id, stdout|stderr) -> byte stream`
3. `WriteStdin(job_id) -> byte stream` (optional)
4. `Wait(job_id) -> status + metadata`
5. `Artifacts.ReadRange(artifact_id, offset, len)`
6. `FS.OpenCap(path, mode) -> fd_cap_id` (optional strong mode)
7. `Approve.Decide(request_id, decision)` (from host executor / SMS)

Transport:

* Unix domain socket
* length-prefixed frames (control JSON) + multiplexed streaming frames

---

# 4) Policy Graph feature (core addition)

## 4.1 Why a graph (vs a flat allowlist)

A flat policy can say “allow curl” or “deny curl.”
A graph can say:

* Root (agent) → allow `gog`, deny `curl`
* `gog` → allow `curl`, but only to specific URLs, and only certain FS
* `jira` → depends on subcommand: `jira create` injects env and might allow network; `jira read` no env and maybe no network

That’s **path-based authority**.

## 4.2 Graph model

### Nodes

A node represents an execution context (“what process is running” + sometimes “operation mode”).

Each node has:

* `id`: stable ID (e.g., `root`, `tool:gog`, `tool:jira:create`, `tool:curl`)
* `match`: how the node is selected for a request
  Examples:

  * match by executable path
  * match by command ID
  * match by argv/subcommand predicate (AST-aware)
* `base_policy`:

  * allowed filesystem roots
  * allowed network mode (deny/proxy-only/allowlist)
  * whether it may request nested exec
  * default env injection rules
* `default_run_as`: agentUser vs hostUser (hostUser typically requires approval)
* `audit/redaction` rules

### Edges

Edges represent allowed transitions: **caller node → callee node**.

An edge can:

* allow/deny the transition
* require approval (and what approval mode is permitted)
* further restrict callee policy (tighten FS/net/args)
* inject or suppress environment variables (contextual)
* impose argument-level constraints for the callee (URL allowlists, flag restrictions)
* set “call depth” limits

**Important:** This is where “`gog → curl to specific URL only`” lives.

## 4.3 Standard policy as a single node

Your existing “flat” policy becomes:

* `root` node with direct allowed command list and constraints
* Edges optional (or implicit root edges)
  Meaning: a single-node policy graph is the backwards-compatible baseline.

---

# 5) Policy evaluation semantics (precise + implementable)

## 5.1 Inputs to evaluation

* `caller_context`: derived from caller token / capability channel (or root if agent)
* `request`: parsed AST (or structured pipeline request)
* `session_context`: workspace root, project metadata, trace mode, etc.

## 5.2 Node selection

Given an exec request (AST stage):

1. Map executable to a `command_id` (e.g., `curl`, `jira`, `gog`, `git`)
2. Find the best matching node(s) by:

  * exact match > predicate match > wildcard match
  * explicit `priority` field breaks ties

Example:

* `jira create` selects `tool:jira:create`
* `jira view` selects `tool:jira:read`

## 5.3 Edge selection + decision

Let `caller_node = node_of_current_process`.
Let `callee_node = node_selected_for_request`.

Find an edge `caller_node → callee_node` whose conditions match (argv, session, etc.).

* If none: **deny**
* If edge requires approval: return **NEEDS_APPROVAL**
* Else: **allow** and produce an **effective policy** for the callee

## 5.4 Effective policy composition

Effective policy =

1. **Global invariants** (never relaxable)

  * deny unregistered binaries
  * deny direct exec bypass paths
  * deny disallowed device/privileged syscalls (as applicable)
2. Apply **callee node base_policy**
3. Apply **edge overrides/constraints**

  * typically *tightening* (FS roots, network allowlist)
  * argument validation (URL patterns, allowed flags)
  * env injection modifications (add/remove/require)
4. Apply **session constraints** (workspace root, trace mode)

---

# 6) Caller path tracking (how the graph stays correct)

You need the Broker to know “who is calling” for nested exec requests.

## 6.1 Mechanism A (recommended): capability channel FD

When Broker spawns a process (Sandbox B), it passes:

* a pre-connected socket FD (e.g., fd 3) back to Broker
* env: `AGSHIELD_BROKER_FD=3`

Any nested exec request from that process must go over this FD.
Broker therefore knows the caller job identity with high confidence (no token copying needed).

## 6.2 Mechanism B (optional): signed caller token

Broker also injects:

* `AGSHIELD_CALLER_TOKEN=<signed blob>`
* includes job_id, node_id, issued_at, expiry
* broker verifies signature + freshness

Use this for tooling that can’t use a passed FD (legacy wrappers).

## 6.3 Nested exec interception strategy

To make “`gog` can call `curl` only via policy” real:

* Deny direct exec in Sandbox B for most tools (or allow only immutable wrappers/broker client).
* Provide **immutable tool wrappers** (root-owned) that:

  * parse/validate minimal args
  * forward to Broker including caller context (FD/token)
  * do *not* run shells
* Long-term: replace wrappers by linking a small `agenshield_exec` client lib into internal tools (like `gog`) so they call Broker directly.

---

# 7) AST parser and pipeline support (safe “shell-like” behavior)

## 7.1 Supported grammar (start strict)

Phase 1:

* `command := WORD (WORD)*`
* `pipeline := command ('|' command)*`

Rejected:

* `;`, `&&`, `||`
* `$()`, backticks
* arbitrary redirects `>`, `<` (until you add safe redirect support)
* globbing / env assignment inline (env comes from policy injection)

## 7.2 Pipelines execution model

Broker spawns each stage and connects pipes:

* stage1.stdout → stage2.stdin → … → final.stdout
* streams final output back to agent
* optionally streams intermediate stderr per-stage

Policy is evaluated per stage using caller path:

* In a pipeline spawned directly by agent, caller_node is root for stage1.
* For stage2/stage3, you can treat caller as root as well (broker-managed pipeline), OR model as “pipeline context node”. Choose one and keep it consistent.

---

# 8) Dynamic Seatbelt strategy (Sandbox A and per-exec Sandbox B)

## 8.1 Sandbox A (Agent)

* Default deny
* Allow:

  * IPC to Broker socket
  * minimal FS needed for agent runtime
  * workspace read/write according to OS perms/ACL
* Deny:

  * process-exec (or allow only a single broker client if unavoidable)
  * network (except loopback to broker/proxy if needed)

## 8.2 Sandbox B (Per process execution)

Generated from effective policy. Must be strict:

* Allow only:

  * necessary file reads/writes within allowed roots
  * network mode:

    * deny all
    * proxy-only
    * allowlist hosts (if you support it)
  * minimal system interactions needed
* Deny:

  * exec by default (or allow only immutable wrappers / broker client)

## 8.3 Performance: profile caching

Dynamic profiles can be expensive.

* Compute `sandbox_hash = SHA256(effective_policy_blob)`
* Cache generated profile files under a supervisor-owned directory
* Reuse across runs until policy version changes
* Never allow agentUser to write/modify cached profiles

---

# 9) Environment injection and secrets (contextual, graph-based)

Env injection happens at spawn time (Supervisor/Broker), not inside Seatbelt.

## 9.1 Where env rules live

* Node env rules: default env for that node
* Edge env rules: additional env for a specific caller→callee context
* Conditions can depend on:

  * caller path
  * callee subcommand (AST)
  * session metadata

## 9.2 Jira example

* Node: `tool:jira:read`

  * env: none (or minimal)
  * FS: allowed workspace read
  * net: deny or proxy-only without auth
* Node: `tool:jira:create`

  * env: inject `JIRA_TOKEN`, `JIRA_BASE_URL`
  * net: proxy-only + allowlist `jira.company.com`
  * FS: allowed workspace read/write (if needed)

## 9.3 Gog → curl example

* Node: `tool:gog`

  * env injected before execution (e.g., `GOG_ENV=prod`, `GOG_TRACE=1`)
  * FS: only specific roots
* Edge: `tool:gog → tool:curl`

  * restrict curl URL patterns:

    * `https://api.example.com/*`
  * deny all other curl flags except allowlisted subset
  * net: proxy-only + allowlist domain

## 9.4 Secret handling

* Secrets fetched only when needed for that node/edge
* Never log secret values
* Prefer ephemeral in-memory only
* If you store grants, store only scope hashes, not secrets

---

# 10) HostUser delegated execution (popup/SMS approvals) integrated with policy graph

## 10.1 What gets approved

Approval is for a **scope**, not for “become hostUser.”

Scope should include:

* caller path (node path)
* exact command AST (or bounded schema)
* cwd/workspace
* intended FS/net permissions (effective policy summary)
* run_as=hostUser
* duration mode: ONCE or TTL

## 10.2 Approval channels

* Primary: hostUser system notification popup with action buttons
* Optional: SMS approval

## 10.3 Grant types

* **ONCE**: one execution only, exact scope hash
* **TTL (e.g., 5 minutes)**:

  * either:

    * repeat exact same request, OR
    * a bounded class (same node+subcommand, same workspace, same allowlists)

## 10.4 Execution after approval

When hostUser execution is approved:

* hostUser executor spawns the process as hostUser
* still under a sandbox B derived from effective policy
* streams output back to Broker → Agent

This avoids giving `agentUser` the ability to “sudo to hostUser.”

## 10.5 What the user sees (graph-aware prompt)

The prompt should show:

* Requested command
* Caller path (explainable):

  * `Agent(root) → gog → curl`
* Consequences:

  * env injected (names, not secrets)
  * network allowed (domains)
  * filesystem allowed (roots)
  * duration requested (once / 5 minutes)
* Buttons: Approve once / Approve 5 minutes / Deny

---

# 11) Policy Graph “consequence reporting” (your new UX requirement)

This is the feature that lets you tell the user:

> “If you allow `gog`, it injects env before execution; and inside `gog`, `curl` is allowed only to URL X; FS access is limited to Y.”

## 11.1 Consequence report generation

Given a requested node (e.g., `tool:gog`) and the current caller path, compute:

* immediate effective policy for that node
* reachable next-step edges (depth-limited) with their constraints

Return a human-friendly summary:

* env changes
* allowed nested commands
* nested network/FS restrictions
* approvals required for any nested edges

## 11.2 Depth and safety

* Limit depth (e.g., 2–3 hops) to keep prompts readable
* For deeper graphs, provide “Show details” in UI (optional)

---

# 12) Filesystem, large files, and artifacts

## 12.1 Workspace model (default)

* Supervisor creates per-session workspace root
* Policy expresses FS permissions relative to workspace and a small set of other safe roots

## 12.2 FD capability model (strong mode, recommended)

When needed:

* Broker opens file safely (openat, nofollow, normalized path)
* passes FD to tool process
* tool reads/writes via FD
  This minimizes path tricks and supports large files efficiently.

## 12.3 Output streaming vs spooling

* Stream up to N bytes/lines
* Beyond threshold:

  * spool to artifact file
  * return artifact_id with metadata
* Agent can request `ReadRange` for partial reading

---

# 13) Networking

## 13.1 Default: deny

* Agent sandbox A: deny network (except loopback if required)
* Tool sandbox B: deny unless policy says otherwise

## 13.2 Proxy-only mode (recommended)

* Tool only connects to local proxy
* Broker injects proxy env vars
* Proxy enforces allowlisted domains per node/edge

---

# 14) Audit and telemetry (must be first-class)

Every job should produce:

* `session_id`, `job_id`, `parent_job_id`
* `caller_path` (node IDs)
* policy decision record:

  * selected node/edge
  * effective policy hash
* approval data if any:

  * request_id, channel, who approved, grant_id, TTL/once
* spawn details:

  * executable ID (not raw path in logs unless needed)
  * args redacted by policy
  * sandbox hash, env keys injected
* outputs:

  * exit code
  * artifact references + hashes

Optional: integrate your patched node/python interceptors as telemetry sources correlated by job_id.

---

# 15) Migration plan from your current wrapper-based system

You already have:

* system user + ACL-based FS control
* dynamic seatbelt generation
* wrappers in `$HOME/bin`
* patched runtimes intercepting exec/fs/net

Migration should be staged:

## Phase M1: Introduce Broker as the single authority

* Keep wrappers, but convert them into “broker clients”
* Move wrappers to an immutable, root-owned directory
* Stop “exec outside seatbelt” hops
* Broker spawns real tools under sandbox B

## Phase M2: Add Policy Graph + caller path tracking

* Broker injects caller channel/token
* Wrappers forward caller context for nested exec

## Phase M3: Add HostUser executor + approvals

* HostUser component handles hostUser runs only after grant

## Phase M4: Remove wrappers for internal tools

* For `gog`, link in a broker client library or provide explicit broker integration
* Keep wrappers only for third-party binaries if needed

---

# 16) Implementation roadmap (work packages for code agents)

## WP0 — Spec + skeleton

* Define graph schema (YAML/JSON), examples, validation rules
* Define IPC protocol frames (exec/stream/wait/approval)

## WP1 — Broker MVP (single command, streaming)

* Exec allowlist, spawn sandbox B, stream stdout/stderr
* Session and job registry

## WP2 — AST parser + pipelines

* Parse pipelines, validate grammar, spawn pipeline with FD wiring
* Policy evaluation per stage

## WP3 — Policy Graph engine

* Node matcher compiler (exec path + argv predicates)
* Edge selection with conditions
* Effective policy composition + hashing
* Consequence report generator

## WP4 — Caller path tracking

* Implement capability channel FD passing (preferred)
* Implement signed token fallback for wrappers
* Update wrappers to forward caller context

## WP5 — Dynamic Seatbelt generator + caching

* Build templates, expand effective policy, cache by hash
* Enforce immutable cache storage

## WP6 — HostUser approver/executor

* Local notification UI with actions
* Approval router + grant store
* HostUser job execution with sandbox B

## WP7 — SMS approvals (optional)

* Outbound request formatting
* Inbound reply validation + OTP
* Bind OTP to request scope hash

## WP8 — Network proxy-only enforcement (optional but recommended)

* Local proxy
* Policy-driven domain allowlists
* Broker env injection

## WP9 — Tests and security suite

* AST fuzzing
* Graph edge resolution tests
* Approval grant replay tests
* “curl forbidden unless gog→curl edge” tests
* “jira create injects env, jira read does not” tests
* Large file artifact tests
* Negative tests: symlinks, path traversal, env injection abuse

---

# 17) Appendix: Example Policy Graph (illustrative)

Here’s a compact example showing your `gog` and `jira` requirements:

```yaml
version: 1

nodes:
  - id: root
    match: { type: root }
    base_policy:
      run_as: agentUser
      allow_exec: ["tool:gog", "tool:jira:read", "tool:jira:create", "tool:git"]
      net: { mode: deny }
      fs: { allow_roots: ["${workspace}"] }
      env: []

  - id: tool:gog
    match:
      type: exec
      command_id: gog
    base_policy:
      run_as: agentUser
      net: { mode: deny }          # gog itself no direct net (forces curl via broker)
      fs:  { allow_roots: ["${workspace}/deploy", "${workspace}/.gog"] }
      env:
        - { name: "GOG_ENV", value: "prod" }
        - { name: "AGSHIELD_TRACE", value: "1", when: "session.trace_enabled" }

  - id: tool:curl
    match: { type: exec, command_id: curl }
    base_policy:
      run_as: agentUser
      net: { mode: proxy_only }
      fs:  { allow_roots: ["${workspace}/.cache/curl"] }
      env: []

  - id: tool:jira:read
    match:
      type: exec
      command_id: jira
      argv_predicate: { subcommand_in: ["view", "get", "list", "search"] }
    base_policy:
      run_as: agentUser
      net: { mode: deny }
      fs:  { allow_roots: ["${workspace}"] }
      env: []

  - id: tool:jira:create
    match:
      type: exec
      command_id: jira
      argv_predicate: { subcommand_in: ["create"] }
    base_policy:
      run_as: agentUser
      net: { mode: proxy_only, allow_hosts: ["jira.company.com"] }
      fs:  { allow_roots: ["${workspace}"] }
      env:
        - { name: "JIRA_TOKEN", value_from: "secrets.jira_token" }
        - { name: "JIRA_BASE_URL", value: "https://jira.company.com" }

edges:
  - from: root
    to: tool:gog
    allow: true

  - from: tool:gog
    to: tool:curl
    allow: true
    constraints:
      argv_schema:
        allow_flags: ["-sS", "-L", "--fail", "-H", "--data", "--request"]
        url_allowlist: ["https://api.example.com/*"]
      net:
        mode: proxy_only
        allow_hosts: ["api.example.com"]

  - from: root
    to: tool:jira:read
    allow: true

  - from: root
    to: tool:jira:create
    allow: true
    # optionally require approval to create tickets:
    approval:
      required: true
      modes: ["ONCE", "TTL_300"]
      prompt_hint: "Creating Jira tickets can post externally."
```

---

# 18) What you should decide now (to unblock implementation)

These choices affect design a lot; I’m giving defaults so you can proceed without a long back-and-forth:

1. **Caller tracking**: use FD capability channel as default; token only for legacy wrappers.
2. **Graph matching**: prioritize explicit subcommand nodes (e.g. `jira:create`) over complicated conditional env rules.
3. **Approval binding**: default to exact-scope binding; allow bounded-class TTL only when explicitly configured.
4. **Curl control**: enforce URL allowlists at broker argument validation + proxy allowlist (belt + suspenders).
5. **Exec inside tools**: default deny; nested exec must go through broker/wrappers.

---

If you want, I can convert this plan into:

* a set of **GitHub issues** (one per work package, with acceptance criteria), or
* a **single “architecture.md”** that is formatted for your repo docs folder, including sequence diagrams and message frame specs.
