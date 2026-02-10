---
name: agenco-google-calendar
description: "Google Calendar actions available through AgenCo"
user-invocable: false
disable-model-invocation: false
---

# Google Calendar

Actions available through AgenCo secure gateway. All credentials are stored in the cloud vault — never exposed locally.

## Actions

| Action | Description |
|--------|-------------|
| list_events | Retrieves upcoming calendar events to check schedules and availability |
| get_event | Fetches details of a specific calendar event including attendees and location |
| create_event | Creates new calendar events with title, time, attendees, and reminders |
| update_event | Modifies existing calendar events to change time, attendees, or details |
| delete_event | Removes calendar events that are no longer needed |
| quick_add_event | Creates events from natural language descriptions like 'Meeting tomorrow at 3pm' |
| query_free_busy | Checks availability across calendars to find open meeting times |

## How to Use

**Always search first** to discover exact tool names and their input schemas, then call the tool.

### Step 1: Search for the tool

```bash
agenco search-tools '{"queries":["google calendar list events"]}'
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
agenco search-tools '{"queries":["google calendar list events"]}'

# Call it (use the exact toolName and schema from the search result)
agenco call-tool '{"toolName":"google-calendar_list_events","input":{...}}'
```

> If Google Calendar is not connected, run `agenco list-connected-integrations` to check, then connect it via the Shield UI.
