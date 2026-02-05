---
name: integration-buddy
description: "Buddy actions available through AgentLink"
user-invocable: false
disable-model-invocation: false
---

# Buddy

Actions available through AgentLink secure gateway. All credentials are stored in the cloud vault — never exposed locally.

## Actions

| Action | Description |
|--------|-------------|
| list_workspaces | Retrieves Buddy workspaces |
| list_projects | Gets projects |
| list_pipelines | Retrieves CI/CD pipelines |
| run_pipeline | Triggers pipeline execution |

## How to Use

**Always search first** to discover exact tool names and their input schemas, then call the tool.

### Step 1: Search for the tool

```bash
agentlink search-tools '{"queries":["buddy list workspaces"]}'
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
agentlink search-tools '{"queries":["buddy list workspaces"]}'

# Call it (use the exact toolName and schema from the search result)
agentlink call-tool '{"toolName":"buddy_list_workspaces","input":{...}}'
```

> If Buddy is not connected, run `agentlink list-connected-integrations` to check, then connect it via the Shield UI.
