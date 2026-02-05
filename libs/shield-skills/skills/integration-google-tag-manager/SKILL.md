---
name: integration-google-tag-manager
description: "Google Tag Manager actions available through AgentLink"
user-invocable: false
disable-model-invocation: false
---

# Google Tag Manager

Actions available through AgentLink secure gateway. All credentials are stored in the cloud vault — never exposed locally.

## Actions

| Action | Description |
|--------|-------------|
| list_accounts | Retrieves GTM accounts |
| list_containers | Gets tag containers |
| list_tags | Retrieves tags in containers |
| create_tag | Creates new tags |
| update_tag | Modifies tag configuration |

## How to Use

**Always search first** to discover exact tool names and their input schemas, then call the tool.

### Step 1: Search for the tool

```bash
agentlink search-tools '{"queries":["google tag manager list accounts"]}'
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
agentlink search-tools '{"queries":["google tag manager list accounts"]}'

# Call it (use the exact toolName and schema from the search result)
agentlink call-tool '{"toolName":"google-tag-manager_list_accounts","input":{...}}'
```

> If Google Tag Manager is not connected, run `agentlink list-connected-integrations` to check, then connect it via the Shield UI.
