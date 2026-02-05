---
name: integration-google-analytics
description: "Google Analytics actions available through AgenCo"
user-invocable: false
disable-model-invocation: false
---

# Google Analytics

Actions available through AgenCo secure gateway. All credentials are stored in the cloud vault — never exposed locally.

## Actions

| Action | Description |
|--------|-------------|
| run_report | Executes analytics reports using reports read permission |
| batch_run_reports | Runs multiple reports simultaneously with reports read permission |
| run_realtime_report | Retrieves real-time analytics data with reports read permission |
| list_accounts | Retrieves GA accounts using accounts read permission |
| list_properties | Retrieves analytics properties with properties read permission |

## How to Use

**Always search first** to discover exact tool names and their input schemas, then call the tool.

### Step 1: Search for the tool

```bash
agenco search-tools '{"queries":["google analytics run report"]}'
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
agenco search-tools '{"queries":["google analytics run report"]}'

# Call it (use the exact toolName and schema from the search result)
agenco call-tool '{"toolName":"google-analytics_run_report","input":{...}}'
```

> If Google Analytics is not connected, run `agenco list-connected-integrations` to check, then connect it via the Shield UI.
