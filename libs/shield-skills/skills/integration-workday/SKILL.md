---
name: integration-workday
description: "Workday actions available through AgenCo"
user-invocable: false
disable-model-invocation: false
---

# Workday

Actions available through AgenCo secure gateway. All credentials are stored in the cloud vault — never exposed locally.

## Actions

| Action | Description |
|--------|-------------|
| list_workers | Retrieves employee records |
| get_worker | Fetches employee details and position |
| update_worker | Modifies employee information |
| list_organizations | Gets organizational structure |
| list_time_entries | Retrieves time tracking records |
| create_time_entry | Records worked hours |
| list_absences | Gets absence and leave requests |
| create_absence | Submits leave requests |

## How to Use

**Always search first** to discover exact tool names and their input schemas, then call the tool.

### Step 1: Search for the tool

```bash
agenco search-tools '{"queries":["workday list workers"]}'
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
agenco search-tools '{"queries":["workday list workers"]}'

# Call it (use the exact toolName and schema from the search result)
agenco call-tool '{"toolName":"workday_list_workers","input":{...}}'
```

> If Workday is not connected, run `agenco list-connected-integrations` to check, then connect it via the Shield UI.
