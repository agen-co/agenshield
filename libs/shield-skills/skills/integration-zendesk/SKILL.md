---
name: integration-zendesk
description: "Zendesk actions available through AgentLink"
user-invocable: false
disable-model-invocation: false
---

# Zendesk

Actions available through AgentLink secure gateway. All credentials are stored in the cloud vault — never exposed locally.

## Actions

| Action | Description |
|--------|-------------|
| list_tickets | Retrieves support tickets with status filters |
| get_ticket | Fetches ticket details including comments and history |
| create_ticket | Opens new support tickets with requester info |
| update_ticket | Modifies ticket status, priority, or assignee |
| search_tickets | Searches tickets by keywords or criteria |
| list_users | Retrieves agents and end users |
| create_user | Creates new user accounts in Zendesk |
| list_organizations | Gets organization records for grouping users |
| list_groups | Retrieves agent groups for ticket routing |

## How to Use

**Always search first** to discover exact tool names and their input schemas, then call the tool.

### Step 1: Search for the tool

```bash
agentlink search-tools '{"queries":["zendesk list tickets"]}'
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
agentlink search-tools '{"queries":["zendesk list tickets"]}'

# Call it (use the exact toolName and schema from the search result)
agentlink call-tool '{"toolName":"zendesk_list_tickets","input":{...}}'
```

> If Zendesk is not connected, run `agentlink list-connected-integrations` to check, then connect it via the Shield UI.
