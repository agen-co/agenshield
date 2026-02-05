---
name: integration-azure-devops
description: "Azure DevOps actions available through AgenCo"
user-invocable: false
disable-model-invocation: false
---

# Azure DevOps

Actions available through AgenCo secure gateway. All credentials are stored in the cloud vault — never exposed locally.

## Actions

| Action | Description |
|--------|-------------|
| list_projects | Retrieves Azure DevOps projects |
| get_project | Fetches project details |
| list_repositories | Gets Git repositories |
| list_builds | Retrieves build pipelines |
| queue_build | Triggers new builds |
| list_work_items | Gets work items and tasks |
| create_work_item | Creates new work items |

## How to Use

**Always search first** to discover exact tool names and their input schemas, then call the tool.

### Step 1: Search for the tool

```bash
agenco search-tools '{"queries":["azure devops list projects"]}'
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
agenco search-tools '{"queries":["azure devops list projects"]}'

# Call it (use the exact toolName and schema from the search result)
agenco call-tool '{"toolName":"azure-devops_list_projects","input":{...}}'
```

> If Azure DevOps is not connected, run `agenco list-connected-integrations` to check, then connect it via the Shield UI.
