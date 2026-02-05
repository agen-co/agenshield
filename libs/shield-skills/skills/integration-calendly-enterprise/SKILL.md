---
name: integration-calendly-enterprise
description: "Calendly Enterprise actions available through AgentLink"
user-invocable: false
disable-model-invocation: false
---

# Calendly Enterprise

Actions available through AgentLink secure gateway. All credentials are stored in the cloud vault — never exposed locally.

## Actions

| Action | Description |
|--------|-------------|
| get_organization | Retrieves organization details and configuration |
| list_members | Gets organization members and their roles |
| list_teams | Retrieves teams within the organization |
| get_sso_config | Fetches SSO configuration settings |
| list_activity_logs | Retrieves audit and activity logs |
| get_reports | Gets usage and event reports |

## How to Use

**Always search first** to discover exact tool names and their input schemas, then call the tool.

### Step 1: Search for the tool

```bash
agentlink search-tools '{"queries":["calendly enterprise get organization"]}'
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
agentlink search-tools '{"queries":["calendly enterprise get organization"]}'

# Call it (use the exact toolName and schema from the search result)
agentlink call-tool '{"toolName":"calendly-enterprise_get_organization","input":{...}}'
```

> If Calendly Enterprise is not connected, run `agentlink list-connected-integrations` to check, then connect it via the Shield UI.
