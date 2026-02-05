---
name: integration-sentry
description: "Sentry actions available through AgenCo"
user-invocable: false
disable-model-invocation: false
---

# Sentry

Actions available through AgenCo secure gateway. All credentials are stored in the cloud vault — never exposed locally.

## Actions

| Action | Description |
|--------|-------------|
| list_organizations | Retrieves Sentry organizations |
| list_projects | Gets monitored projects |
| list_issues | Retrieves error issues |
| get_issue | Fetches issue details |
| update_issue | Modifies issue status |
| delete_issue | Removes issues |
| list_events | Gets error events |
| list_releases | Retrieves releases |

## How to Use

**Always search first** to discover exact tool names and their input schemas, then call the tool.

### Step 1: Search for the tool

```bash
agenco search-tools '{"queries":["sentry list organizations"]}'
```

The response includes `toolName` (exact name) and `inputSchema` (required/optional parameters).

### Step 2: Call the tool

Use the exact `toolName` and match the `inputSchema` from the search results:

```bash
agenco call-tool '{"toolName":"<toolName from search>","input":{...}}'
```

### Example

```bash
# Find the right tool
agenco search-tools '{"queries":["sentry list organizations"]}'

# Call it (use the exact toolName and schema from the search result)
agenco call-tool '{"toolName":"sentry_list_organizations","input":{...}}'
```

> If Sentry is not connected, run `agenco list-connected-integrations` to check, then connect it via the Shield UI.
