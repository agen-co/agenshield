---
name: agenco-microsoft-power-automate
description: "Microsoft Power Automate actions available through AgenCo"
user-invocable: false
disable-model-invocation: false
---

# Microsoft Power Automate

Actions available through AgenCo secure gateway. All credentials are stored in the cloud vault — never exposed locally.

## Actions

| Action | Description |
|--------|-------------|
| list_flows | Retrieves automated flows from your Power Automate account |
| get_flow | Fetches detailed information about a specific flow |
| run_flow | Triggers execution of a designated flow |
| list_runs | Gets the historical record of flow run executions |

## How to Use

**Always search first** to discover exact tool names and their input schemas, then call the tool.

### Step 1: Search for the tool

```bash
agenco search-tools '{"queries":["microsoft power automate list flows"]}'
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
agenco search-tools '{"queries":["microsoft power automate list flows"]}'

# Call it (use the exact toolName and schema from the search result)
agenco call-tool '{"toolName":"microsoft-power-automate_list_flows","input":{...}}'
```

> If Microsoft Power Automate is not connected, run `agenco list-connected-integrations` to check, then connect it via the Shield UI.
