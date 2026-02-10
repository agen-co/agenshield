---
name: agenco-clickup
description: "ClickUp actions available through AgenCo"
user-invocable: false
disable-model-invocation: false
---

# ClickUp

Actions available through AgenCo secure gateway. All credentials are stored in the cloud vault — never exposed locally.

## Actions

| Action | Description |
|--------|-------------|
| get_workspaces | Retrieves accessible workspaces |
| get_spaces | Gets spaces within workspaces |
| get_tasks | Retrieves tasks with status |
| create_task | Creates new tasks with details |

## How to Use

**Always search first** to discover exact tool names and their input schemas, then call the tool.

### Step 1: Search for the tool

```bash
agenco search-tools '{"queries":["clickup get workspaces"]}'
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
agenco search-tools '{"queries":["clickup get workspaces"]}'

# Call it (use the exact toolName and schema from the search result)
agenco call-tool '{"toolName":"clickup_get_workspaces","input":{...}}'
```

> If ClickUp is not connected, run `agenco list-connected-integrations` to check, then connect it via the Shield UI.
