---
name: integration-calendly
description: "Calendly actions available through AgentLink"
user-invocable: false
disable-model-invocation: false
---

# Calendly

Actions available through AgentLink secure gateway. All credentials are stored in the cloud vault — never exposed locally.

## Actions

| Action | Description |
|--------|-------------|
| get_current_user | Retrieves authenticated user info |
| list_event_types | Gets scheduling link types |
| get_event_type | Fetches event type details |
| list_events | Retrieves scheduled events |
| get_event | Fetches event details and invitee |
| cancel_event | Cancels scheduled events |
| list_invitees | Gets event invitee information |
| list_webhooks | Retrieves configured webhooks |

## How to Use

**Always search first** to discover exact tool names and their input schemas, then call the tool.

### Step 1: Search for the tool

```bash
agentlink search-tools '{"queries":["calendly get current user"]}'
```

The response includes `toolName` (exact name) and `inputSchema` (required/optional parameters).

### Step 2: Call the tool

Use the exact `toolName` and match the `inputSchema` from the search results:

```bash
agentlink call-tool '{"toolName":"<toolName from search>","input":{...}}'
```

### Example

```bash
# Find the right tool
agentlink search-tools '{"queries":["calendly get current user"]}'

# Call it (use the exact toolName and schema from the search result)
agentlink call-tool '{"toolName":"calendly_get_current_user","input":{...}}'
```

> If Calendly is not connected, run `agentlink list-connected-integrations` to check, then connect it via the Shield UI.
