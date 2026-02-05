---
name: integration-n8n
description: "n8n actions available through AgenCo"
user-invocable: false
disable-model-invocation: false
---

# n8n

Actions available through AgenCo secure gateway. All credentials are stored in the cloud vault — never exposed locally.

## Actions

| Action | Description |
|--------|-------------|
| list_workflows | Retrieves n8n workflows |
| get_workflow | Fetches workflow details |
| create_workflow | Creates new workflows |
| activate_workflow | Enables workflow execution |
| execute_workflow | Triggers manual execution |
| list_executions | Gets execution history |
| list_credentials | Retrieves stored credentials |

## How to Use

**Always search first** to discover exact tool names and their input schemas, then call the tool.

### Step 1: Search for the tool

```bash
agenco search-tools '{"queries":["n8n list workflows"]}'
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
agenco search-tools '{"queries":["n8n list workflows"]}'

# Call it (use the exact toolName and schema from the search result)
agenco call-tool '{"toolName":"n8n_list_workflows","input":{...}}'
```

> If n8n is not connected, run `agenco list-connected-integrations` to check, then connect it via the Shield UI.
