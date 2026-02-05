---
name: integration-pinterest
description: "Pinterest actions available through AgentLink"
user-invocable: false
disable-model-invocation: false
---

# Pinterest

Actions available through AgentLink secure gateway. All credentials are stored in the cloud vault — never exposed locally.

## Actions

| Action | Description |
|--------|-------------|
| get_user | Retrieves account information |
| list_boards | Gets Pinterest boards |
| get_board | Fetches board details |
| create_board | Creates new boards |
| list_pins | Retrieves pins from boards |
| create_pin | Creates new pins |
| delete_pin | Removes pins from boards |
| upload_media | Uploads images for pins |

## How to Use

**Always search first** to discover exact tool names and their input schemas, then call the tool.

### Step 1: Search for the tool

```bash
agentlink search-tools '{"queries":["pinterest get user"]}'
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
agentlink search-tools '{"queries":["pinterest get user"]}'

# Call it (use the exact toolName and schema from the search result)
agentlink call-tool '{"toolName":"pinterest_get_user","input":{...}}'
```

> If Pinterest is not connected, run `agentlink list-connected-integrations` to check, then connect it via the Shield UI.
