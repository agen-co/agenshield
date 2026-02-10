---
name: agenco-bamboohr
description: "BambooHR actions available through AgenCo"
user-invocable: false
disable-model-invocation: false
---

# BambooHR

Actions available through AgenCo secure gateway. All credentials are stored in the cloud vault — never exposed locally.

## Actions

| Action | Description |
|--------|-------------|
| list_employees | Retrieves the employee directory |
| get_employee | Fetches individual employee profile and details |
| create_employee | Adds new employee records to the system |
| update_employee | Modifies existing employee information |
| list_time_off_requests | Gets vacation and leave requests |
| create_time_off_request | Submits new time off requests |
| list_time_off_types | Gets available leave types |
| get_company_info | Retrieves company settings and information |

## How to Use

**Always search first** to discover exact tool names and their input schemas, then call the tool.

### Step 1: Search for the tool

```bash
agenco search-tools '{"queries":["bamboohr list employees"]}'
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
agenco search-tools '{"queries":["bamboohr list employees"]}'

# Call it (use the exact toolName and schema from the search result)
agenco call-tool '{"toolName":"bamboohr_list_employees","input":{...}}'
```

> If BambooHR is not connected, run `agenco list-connected-integrations` to check, then connect it via the Shield UI.
