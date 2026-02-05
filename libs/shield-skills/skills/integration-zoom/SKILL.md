---
name: integration-zoom
description: "Zoom actions available through AgenCo"
user-invocable: false
disable-model-invocation: false
---

# Zoom

Actions available through AgenCo secure gateway. All credentials are stored in the cloud vault — never exposed locally.

## Actions

| Action | Description |
|--------|-------------|
| list_meetings | Retrieves scheduled meetings for the user |
| get_meeting | Fetches details of a specific meeting |
| create_meeting | Schedules new meetings with settings and invitees |
| update_meeting | Modifies meeting time, settings, or participants |
| delete_meeting | Cancels scheduled meetings |
| list_registrants | Gets registered participants for webinars and meetings |
| list_recordings | Retrieves cloud recordings for meetings |
| get_recording | Fetches specific recording files and transcripts |
| list_users | Gets Zoom users in the account |

## How to Use

**Always search first** to discover exact tool names and their input schemas, then call the tool.

### Step 1: Search for the tool

```bash
agenco search-tools '{"queries":["zoom list meetings"]}'
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
agenco search-tools '{"queries":["zoom list meetings"]}'

# Call it (use the exact toolName and schema from the search result)
agenco call-tool '{"toolName":"zoom_list_meetings","input":{...}}'
```

> If Zoom is not connected, run `agenco list-connected-integrations` to check, then connect it via the Shield UI.
