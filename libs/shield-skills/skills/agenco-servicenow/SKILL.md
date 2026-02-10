---
name: agenco-servicenow
description: "ServiceNow actions available through AgenCo"
user-invocable: false
disable-model-invocation: false
---

# ServiceNow

Actions available through AgenCo secure gateway. All credentials are stored in the cloud vault — never exposed locally.

## Actions

| Action | Description |
|--------|-------------|
| list_incidents | Retrieves IT incidents with status information |
| get_incident | Fetches incident details and notes |
| create_incident | Opens new IT incidents |
| update_incident | Modifies incident status or assignment |
| list_change_requests | Gets change request records |
| create_change_request | Opens new change requests |
| list_users | Retrieves user accounts |
| get_current_user | Gets authenticated user info |
| list_catalog_items | Retrieves service catalog items |

## How to Use

**Always search first** to discover exact tool names and their input schemas, then call the tool.

### Step 1: Search for the tool

```bash
agenco search-tools '{"queries":["servicenow list incidents"]}'
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
agenco search-tools '{"queries":["servicenow list incidents"]}'

# Call it (use the exact toolName and schema from the search result)
agenco call-tool '{"toolName":"servicenow_list_incidents","input":{...}}'
```

> If ServiceNow is not connected, run `agenco list-connected-integrations` to check, then connect it via the Shield UI.
