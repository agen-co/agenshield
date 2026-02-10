---
name: agenco-google-tasks
description: "Google Tasks actions available through AgenCo"
user-invocable: false
disable-model-invocation: false
---

# Google Tasks

Actions available through AgenCo secure gateway. All credentials are stored in the cloud vault — never exposed locally.

## Actions

| Action | Description |
|--------|-------------|
| list_task_lists | Retrieves task lists from your account |
| get_task_list | Fetches detailed information about a specific task list |
| create_task_list | Establishes new task lists for organization |
| list_tasks | Retrieves tasks contained within lists |
| create_task | Adds new tasks to existing lists |
| update_task | Modifies task content or completion status |
| delete_task | Removes tasks from lists |

## How to Use

**Always search first** to discover exact tool names and their input schemas, then call the tool.

### Step 1: Search for the tool

```bash
agenco search-tools '{"queries":["google tasks list task lists"]}'
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
agenco search-tools '{"queries":["google tasks list task lists"]}'

# Call it (use the exact toolName and schema from the search result)
agenco call-tool '{"toolName":"google-tasks_list_task_lists","input":{...}}'
```

> If Google Tasks is not connected, run `agenco list-connected-integrations` to check, then connect it via the Shield UI.
