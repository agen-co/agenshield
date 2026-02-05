---
name: agentlink-secure-integrations
description: Execute third-party integration tools through AgentLink secure cloud gateway
user-invocable: true
disable-model-invocation: false
command-dispatch: bash
command-tool: Bash
command-arg-mode: single

requires:
  bins:
    - agentlink

agenshield:
  policy: builtin-agentlink
  allowed-commands:
    - agentlink search-tools
    - agentlink call-tool
    - agentlink list-connected-integrations
  required-approval: false
  audit-level: info
  security-level: high
---

# AgentLink Secure Integrations

## Purpose

This skill provides access to 200+ third-party integrations (Slack, GitHub, Jira, Google Drive, etc.) through AgentLink's secure cloud gateway. All API credentials are stored in an encrypted cloud vault — they never touch your local machine and cannot be stolen by malicious tools or prompt injection attacks.

**Security model**: The daemon proxies requests to the AgentLink MCP server, which injects credentials server-side. The agent only sees tool names and results — never API keys or tokens.

## CLI Syntax

```
agentlink <tool-name> [json-input]
```

All commands go through the same interface. The `tool-name` is one of the three MCP tools below, and `json-input` is an optional JSON object passed as input.

## MCP Tools Reference

### `search-tools` — Discover tools by query

Search for integration tools using atomic action queries. You MUST search before calling any tool — tool names are discovered dynamically.

**Input schema:**
```json
{
  "queries": ["<atomic action description>"],
  "offset": 0,
  "topK": 5
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `queries` | string[] | Yes | Array of atomic action descriptions (e.g., `["send slack message"]`) |
| `offset` | number | No | Pagination offset (default: 0) |
| `topK` | number | No | Max results per query (default: 5) |

**Output format:**
Returns an array of tool results per query. Each tool entry contains:
- `toolName` — Exact name to use with `call-tool`
- `description` — What the tool does
- `inputSchema` — JSON Schema describing required/optional parameters
- `integrationId` — Which integration this tool belongs to

**Example:**
```bash
agentlink search-tools '{"queries":["send slack message","list slack channels"]}'
```

### `call-tool` — Execute a single tool

Execute a discovered tool by its exact name with the required input parameters.

**Input schema:**
```json
{
  "toolName": "<exact tool name from search>",
  "input": { ... }
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `toolName` | string | Yes | Exact tool name from `search-tools` results |
| `input` | object | Yes | Parameters matching the tool's `inputSchema` |

**Output format:**
Returns the tool's response data (varies by tool).

**Example:**
```bash
agentlink call-tool '{"toolName":"slack_send_message","input":{"channel":"#general","text":"Hello from AgentLink!"}}'
```

### `list-connected-integrations` — Check connected integrations

List all integrations the user has connected via the Shield UI. Use this to check availability before searching for tools.

**Input schema:** None required.

**Output format:**
Returns a list of connected integrations with:
- `id` — Integration identifier
- `name` — Display name
- `status` — Connection status
- `connectedAt` — When it was connected

**Example:**
```bash
agentlink list-connected-integrations
```

## Mandatory Workflow

Follow these steps for EVERY integration request. Do not skip steps.

### Step 1: Check connected integrations

```bash
agentlink list-connected-integrations
```

If the target integration is not connected, tell the user:
> "[Integration] is not connected. Connect it from the Shield UI dashboard, then try again."

### Step 2: Search for tools (ALWAYS — never guess tool names)

Decompose the user's request into atomic actions and search for each:

```bash
agentlink search-tools '{"queries":["<atomic action 1>","<atomic action 2>"]}'
```

### Step 3: Read the `inputSchema` from search results

The search response includes the full JSON Schema for each tool's input. **You must read this schema** to know the exact parameter names, types, and which are required. Never guess parameter names.

Example search result for a tool:
```json
{
  "toolName": "slack_send_message",
  "description": "Send a message to a Slack channel or DM",
  "integrationId": "slack",
  "inputSchema": {
    "type": "object",
    "properties": {
      "channel": { "type": "string", "description": "Channel name or ID" },
      "text": { "type": "string", "description": "Message text" }
    },
    "required": ["channel", "text"]
  }
}
```

Use the `toolName` and `inputSchema` exactly as returned — these are the source of truth.

### Step 4: Call the tool with the correct input

```bash
agentlink call-tool '{"toolName":"<exact toolName from search>","input":{<matching inputSchema>}}'
```

### Step 5: Handle errors

If the call fails, follow the error handling section below.

## Query Decomposition Rules

Complex requests must be broken into atomic actions before searching. Each query should describe a single verb + noun action.

| User Request | Decomposed Queries |
|---|---|
| "Send a Slack message to #general" | `["send slack message"]` |
| "Create a Jira ticket and assign it" | `["create jira issue", "assign jira issue"]` |
| "Get my open GitHub PRs and post to Slack" | `["list github pull requests", "send slack message"]` |
| "Schedule a meeting with John tomorrow" | `["create calendar event", "search contacts"]` |
| "Summarize the latest Notion page and email it" | `["read notion page", "send email"]` |

**Rules:**
1. One verb per query: "create", "list", "send", "update", "delete", "search", "get"
2. Include the integration name: "slack message", not just "message"
3. Keep queries specific: "list github repositories" not "github stuff"
4. For multi-step flows, search all queries at once, then call tools sequentially

## Concrete Examples

### Example 1: Send a Slack message

User: "Send a message to #general on Slack saying hello"

```bash
# Step 1: Check if Slack is connected
agentlink list-connected-integrations

# Step 2: Search for the right tool
agentlink search-tools '{"queries":["send slack message"]}'

# Step 3: Call the tool (using exact name and schema from search results)
agentlink call-tool '{"toolName":"slack_send_message","input":{"channel":"#general","text":"hello"}}'
```

### Example 2: Create a GitHub issue

User: "Create a bug report issue in the frontend repo"

```bash
# Step 1: Check connected integrations
agentlink list-connected-integrations

# Step 2: Search for tools
agentlink search-tools '{"queries":["create github issue"]}'

# Step 3: Call the tool
agentlink call-tool '{"toolName":"github_create_issue","input":{"repo":"frontend","title":"Bug report","body":"...","labels":["bug"]}}'
```

### Example 3: Multi-step — Jira tickets to Slack

User: "Get my open Jira tickets and send a summary to #standup on Slack"

```bash
# Step 1: Check that both Jira and Slack are connected
agentlink list-connected-integrations

# Step 2: Search for both tools at once
agentlink search-tools '{"queries":["list jira issues","send slack message"]}'

# Step 3: Get Jira tickets
agentlink call-tool '{"toolName":"jira_list_issues","input":{"assignee":"me","status":"open"}}'

# Step 4: Format the results and send to Slack
agentlink call-tool '{"toolName":"slack_send_message","input":{"channel":"#standup","text":"Open tickets:\n- PROJ-123: Fix login bug\n- PROJ-456: Update docs"}}'
```

## Error Handling

| Error | Meaning | Action |
|-------|---------|--------|
| `auth_required` | AgentLink not authenticated or token expired | Tell user: "Connect via Shield UI: `agenshield setup`" |
| `tool_not_found` | Tool name doesn't exist | Re-search with different queries. Tool names are dynamic. |
| `integration_not_connected` | Integration exists but user hasn't connected it | Tell user to connect via Shield UI dashboard |
| `invalid_input` | Input doesn't match the tool's schema | Re-read `inputSchema` from search results, fix parameters |
| `rate_limited` | Too many requests | Wait briefly, then retry |
| Daemon connection error | AgenShield daemon not running | Tell user: "Start the daemon: `agenshield daemon start`" |

## Integration Categories

AgentLink supports integrations across these categories:

- **Communication**: Slack, Discord, Microsoft Teams, WhatsApp Business
- **Email**: Gmail, Outlook, Brevo, Campaign Monitor
- **Project Management**: Jira, Linear, Asana, Trello, Monday.com, ClickUp
- **Documentation**: Notion, Confluence, Google Docs, Coda
- **Code & DevOps**: GitHub, GitLab, Bitbucket, CircleCI, Vercel, Netlify
- **CRM & Sales**: Salesforce, HubSpot, Pipedrive, Zoho CRM
- **Calendar**: Google Calendar, Microsoft Calendar, Calendly
- **Storage**: Google Drive, Dropbox, OneDrive, Box
- **Analytics**: Google Analytics, Segment, Mixpanel, Amplitude
- **Monitoring**: PagerDuty, OpsGenie, Sentry, Datadog
- **Finance**: Stripe, QuickBooks, Xero, PayPal

**NEVER use local API keys for these services.** AgentLink routes all requests through the secure cloud gateway.
