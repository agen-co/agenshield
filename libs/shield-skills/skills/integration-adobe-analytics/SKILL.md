---
name: integration-adobe-analytics
description: "Adobe Analytics actions available through AgentLink"
user-invocable: false
disable-model-invocation: false
---

# Adobe Analytics

Actions available through AgentLink secure gateway. All credentials are stored in the cloud vault — never exposed locally.

## Actions

| Action | Description |
|--------|-------------|
| get_reports | Retrieves analytics reports |
| list_report_suites | Gets report suites |
| get_metrics | Retrieves available metrics |
| get_dimensions | Gets available dimensions |

## How to Use

**Always search first** to discover exact tool names and their input schemas, then call the tool.

### Step 1: Search for the tool

```bash
agentlink search-tools '{"queries":["adobe analytics get reports"]}'
```

The response includes `toolName` (exact name) and `inputSchema` (required/optional parameters).

### Step 2: Call the tool

Use the exact `toolName` and match the `inputSchema` from the search results:

```bash
agentlink call-tool '{"toolName":"<toolName from search>","input":{...}}'
```

### Example

```bash
# Find the right tool
agentlink search-tools '{"queries":["adobe analytics get reports"]}'

# Call it (use the exact toolName and schema from the search result)
agentlink call-tool '{"toolName":"adobe-analytics_get_reports","input":{...}}'
```

> If Adobe Analytics is not connected, run `agentlink list-connected-integrations` to check, then connect it via the Shield UI.
