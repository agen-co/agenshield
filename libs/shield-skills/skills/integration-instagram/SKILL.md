---
name: integration-instagram
description: "Instagram actions available through AgentLink"
user-invocable: false
disable-model-invocation: false
---

# Instagram

Actions available through AgentLink secure gateway. All credentials are stored in the cloud vault — never exposed locally.

## Actions

| Action | Description |
|--------|-------------|
| get_profile | Retrieves account information |
| list_media | Gets posted images and videos |
| get_media | Fetches media details |
| create_media | Publishes new content |
| get_insights | Retrieves account analytics |

## How to Use

**Always search first** to discover exact tool names and their input schemas, then call the tool.

### Step 1: Search for the tool

```bash
agentlink search-tools '{"queries":["instagram get profile"]}'
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
agentlink search-tools '{"queries":["instagram get profile"]}'

# Call it (use the exact toolName and schema from the search result)
agentlink call-tool '{"toolName":"instagram_get_profile","input":{...}}'
```

> If Instagram is not connected, run `agentlink list-connected-integrations` to check, then connect it via the Shield UI.
