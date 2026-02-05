---
name: integration-google-meet
description: "Google Meet actions available through AgenCo"
user-invocable: false
disable-model-invocation: false
---

# Google Meet

Actions available through AgenCo secure gateway. All credentials are stored in the cloud vault — never exposed locally.

## Actions

| Action | Description |
|--------|-------------|
| list_meetings | Retrieves scheduled meetings |
| get_meeting | Fetches meeting details |
| create_meeting | Schedules new meetings |
| delete_meeting | Cancels meetings |

## How to Use

**Always search first** to discover exact tool names and their input schemas, then call the tool.

### Step 1: Search for the tool

```bash
agenco search-tools '{"queries":["google meet list meetings"]}'
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
agenco search-tools '{"queries":["google meet list meetings"]}'

# Call it (use the exact toolName and schema from the search result)
agenco call-tool '{"toolName":"google-meet_list_meetings","input":{...}}'
```

> If Google Meet is not connected, run `agenco list-connected-integrations` to check, then connect it via the Shield UI.
