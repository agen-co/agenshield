---
name: integration-asana
description: "Asana actions available through AgenCo"
user-invocable: false
disable-model-invocation: false
---

# Asana

Actions available through AgenCo secure gateway. All credentials are stored in the cloud vault — never exposed locally.

## Actions

| Action | Description |
|--------|-------------|
| get_task | Retrieves task details including subtasks and attachments |
| create_task | Creates new tasks with assignee, due date, and project |
| update_task | Modifies task fields like status, assignee, or due date |
| delete_task | Removes tasks from projects |
| search_tasks | Finds tasks matching search criteria across projects |
| add_comment | Posts comments on tasks for collaboration |
| list_projects | Retrieves projects from workspaces |
| get_project_tasks | Lists all tasks within a project |
| list_sections | Gets project sections for task organization |
| list_workspaces | Retrieves available workspaces for the user |

## How to Use

**Always search first** to discover exact tool names and their input schemas, then call the tool.

### Step 1: Search for the tool

```bash
agenco search-tools '{"queries":["asana get task"]}'
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
agenco search-tools '{"queries":["asana get task"]}'

# Call it (use the exact toolName and schema from the search result)
agenco call-tool '{"toolName":"asana_get_task","input":{...}}'
```

> If Asana is not connected, run `agenco list-connected-integrations` to check, then connect it via the Shield UI.
