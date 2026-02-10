---
name: agenco-microsoft-teams
description: "Microsoft Teams actions available through AgenCo"
user-invocable: false
disable-model-invocation: false
---

# Microsoft Teams

Actions available through AgenCo secure gateway. All credentials are stored in the cloud vault — never exposed locally.

## Actions

| Action | Description |
|--------|-------------|
| list_teams | Retrieves all teams the user is a member of |
| get_team | Fetches details about a specific team including members and channels |
| list_channels | Gets all channels within a team for message routing |
| send_message | Posts messages to team channels or chat conversations |
| reply_to_message | Sends replies to existing messages in threads |
| create_channel | Creates new channels within teams for organized communication |
| list_chats | Retrieves one-on-one and group chat conversations |
| create_meeting | Schedules new Teams meetings with attendees and options |
| get_users | Lists team members for mentions and assignments |

## How to Use

**Always search first** to discover exact tool names and their input schemas, then call the tool.

### Step 1: Search for the tool

```bash
agenco search-tools '{"queries":["microsoft teams list teams"]}'
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
agenco search-tools '{"queries":["microsoft teams list teams"]}'

# Call it (use the exact toolName and schema from the search result)
agenco call-tool '{"toolName":"microsoft-teams_list_teams","input":{...}}'
```

> If Microsoft Teams is not connected, run `agenco list-connected-integrations` to check, then connect it via the Shield UI.
