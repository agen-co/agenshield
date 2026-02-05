---
name: integration-better-uptime
description: "Better Uptime actions available through AgenCo"
user-invocable: false
disable-model-invocation: false
---

# Better Uptime

Actions available through AgenCo secure gateway. All credentials are stored in the cloud vault — never exposed locally.

## Actions

| Action | Description |
|--------|-------------|
| list_monitors | Retrieves uptime monitors |
| get_monitor | Fetches detailed monitor information |
| create_monitor | Establishes new monitoring instances |
| list_incidents | Retrieves downtime incident data |

## How to Use

**Always search first** to discover exact tool names and their input schemas, then call the tool.

### Step 1: Search for the tool

```bash
agenco search-tools '{"queries":["better uptime list monitors"]}'
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
agenco search-tools '{"queries":["better uptime list monitors"]}'

# Call it (use the exact toolName and schema from the search result)
agenco call-tool '{"toolName":"better-uptime_list_monitors","input":{...}}'
```

> If Better Uptime is not connected, run `agenco list-connected-integrations` to check, then connect it via the Shield UI.
