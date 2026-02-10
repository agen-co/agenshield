---
name: agenco-adp
description: "ADP actions available through AgenCo"
user-invocable: false
disable-model-invocation: false
---

# ADP

Actions available through AgenCo secure gateway. All credentials are stored in the cloud vault — never exposed locally.

## Actions

| Action | Description |
|--------|-------------|
| list_workers | Retrieves employee records |
| get_worker | Fetches employee details and compensation |
| list_pay_statements | Gets employee pay stubs |
| get_pay_statement | Retrieves specific pay statement details |
| list_time_cards | Gets time and attendance records |
| create_time_card | Submits time card entries |
| list_leave_requests | Retrieves leave request records |
| create_leave_request | Submits new leave requests |

## How to Use

**Always search first** to discover exact tool names and their input schemas, then call the tool.

### Step 1: Search for the tool

```bash
agenco search-tools '{"queries":["adp list workers"]}'
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
agenco search-tools '{"queries":["adp list workers"]}'

# Call it (use the exact toolName and schema from the search result)
agenco call-tool '{"toolName":"adp_list_workers","input":{...}}'
```

> If ADP is not connected, run `agenco list-connected-integrations` to check, then connect it via the Shield UI.
