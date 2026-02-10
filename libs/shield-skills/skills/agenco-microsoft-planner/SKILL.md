---
name: agenco-microsoft-planner
description: "Microsoft Planner actions available through AgenCo"
user-invocable: false
disable-model-invocation: false
---

# Microsoft Planner

Actions available through AgenCo secure gateway. All credentials are stored in the cloud vault — never exposed locally.

## Actions

| Action | Description |
|--------|-------------|
| list_plans | Retrieves Planner plans |
| get_plan | Fetches plan details |
| list_tasks | Gets tasks in plans |
| create_task | Creates new tasks |
| update_task | Modifies task details |

## How to Use

**Always search first** to discover exact tool names and their input schemas, then call the tool.

### Step 1: Search for the tool

```bash
agenco search-tools '{"queries":["microsoft planner list plans"]}'
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
agenco search-tools '{"queries":["microsoft planner list plans"]}'

# Call it (use the exact toolName and schema from the search result)
agenco call-tool '{"toolName":"microsoft-planner_list_plans","input":{...}}'
```

> If Microsoft Planner is not connected, run `agenco list-connected-integrations` to check, then connect it via the Shield UI.
