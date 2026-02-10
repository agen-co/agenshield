---
name: agenco-microsoft-calendar
description: "Microsoft Calendar actions available through AgenCo"
user-invocable: false
disable-model-invocation: false
---

# Microsoft Calendar

Actions available through AgenCo secure gateway. All credentials are stored in the cloud vault — never exposed locally.

## Actions

| Action | Description |
|--------|-------------|
| list_calendars | Retrieves all calendars associated with the user's account |
| list_events | Gets scheduled events from specified calendars |
| create_event | Creates new calendar events with attendees and recurrence |
| update_event | Modifies existing events including time, location, or attendees |
| delete_event | Removes events from the calendar |
| accept_event | Accepts meeting invitations and updates attendance status |
| find_meeting_times | Suggests available meeting times based on attendee schedules |
| get_schedule | Retrieves free/busy information for scheduling |

## How to Use

**Always search first** to discover exact tool names and their input schemas, then call the tool.

### Step 1: Search for the tool

```bash
agenco search-tools '{"queries":["microsoft calendar list calendars"]}'
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
agenco search-tools '{"queries":["microsoft calendar list calendars"]}'

# Call it (use the exact toolName and schema from the search result)
agenco call-tool '{"toolName":"microsoft-calendar_list_calendars","input":{...}}'
```

> If Microsoft Calendar is not connected, run `agenco list-connected-integrations` to check, then connect it via the Shield UI.
