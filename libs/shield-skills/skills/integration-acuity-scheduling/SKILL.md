---
name: integration-acuity-scheduling
description: "Acuity Scheduling actions available through AgenCo"
user-invocable: false
disable-model-invocation: false
---

# Acuity Scheduling

Actions available through AgenCo secure gateway. All credentials are stored in the cloud vault — never exposed locally.

## Actions

| Action | Description |
|--------|-------------|
| list_appointments | Retrieves scheduled appointments with read access |
| get_appointment | Fetches detailed appointment information |
| create_appointment | Schedules new appointments |
| update_appointment | Modifies existing appointment details |
| reschedule_appointment | Changes appointment date and time |
| cancel_appointment | Cancels scheduled appointments |
| list_calendars | Gets available calendars |
| check_availability | Retrieves available time slots for booking |

## How to Use

**Always search first** to discover exact tool names and their input schemas, then call the tool.

### Step 1: Search for the tool

```bash
agenco search-tools '{"queries":["acuity scheduling list appointments"]}'
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
agenco search-tools '{"queries":["acuity scheduling list appointments"]}'

# Call it (use the exact toolName and schema from the search result)
agenco call-tool '{"toolName":"acuity-scheduling_list_appointments","input":{...}}'
```

> If Acuity Scheduling is not connected, run `agenco list-connected-integrations` to check, then connect it via the Shield UI.
