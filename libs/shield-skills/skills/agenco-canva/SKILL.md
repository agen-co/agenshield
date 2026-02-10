---
name: agenco-canva
description: "Canva actions available through AgenCo"
user-invocable: false
disable-model-invocation: false
---

# Canva

Actions available through AgenCo secure gateway. All credentials are stored in the cloud vault — never exposed locally.

## Actions

| Action | Description |
|--------|-------------|
| list_designs | Retrieves user designs |
| get_design | Fetches design details |
| create_design | Creates new designs |
| list_folders | Gets design folders |
| upload_asset | Uploads images and assets |

## How to Use

**Always search first** to discover exact tool names and their input schemas, then call the tool.

### Step 1: Search for the tool

```bash
agenco search-tools '{"queries":["canva list designs"]}'
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
agenco search-tools '{"queries":["canva list designs"]}'

# Call it (use the exact toolName and schema from the search result)
agenco call-tool '{"toolName":"canva_list_designs","input":{...}}'
```

> If Canva is not connected, run `agenco list-connected-integrations` to check, then connect it via the Shield UI.
