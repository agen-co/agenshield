---
name: integration-convertkit
description: "ConvertKit actions available through AgenCo"
user-invocable: false
disable-model-invocation: false
---

# ConvertKit

Actions available through AgenCo secure gateway. All credentials are stored in the cloud vault — never exposed locally.

## Actions

| Action | Description |
|--------|-------------|
| list_subscribers | Retrieves subscriber list |
| get_subscriber | Fetches subscriber details |
| create_subscriber | Adds new subscribers |
| tag_subscriber | Adds tags to subscribers |
| list_forms | Gets opt-in forms |
| list_sequences | Retrieves email sequences |
| list_tags | Gets available tags |
| list_broadcasts | Retrieves email broadcasts |

## How to Use

**Always search first** to discover exact tool names and their input schemas, then call the tool.

### Step 1: Search for the tool

```bash
agenco search-tools '{"queries":["convertkit list subscribers"]}'
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
agenco search-tools '{"queries":["convertkit list subscribers"]}'

# Call it (use the exact toolName and schema from the search result)
agenco call-tool '{"toolName":"convertkit_list_subscribers","input":{...}}'
```

> If ConvertKit is not connected, run `agenco list-connected-integrations` to check, then connect it via the Shield UI.
