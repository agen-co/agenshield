---
name: agenco-fastly
description: "Fastly actions available through AgenCo"
user-invocable: false
disable-model-invocation: false
---

# Fastly

Actions available through AgenCo secure gateway. All credentials are stored in the cloud vault — never exposed locally.

## Actions

| Action | Description |
|--------|-------------|
| list_services | Retrieves CDN services |
| get_service | Fetches service details |
| purge_cache | Clears cached content |
| get_stats | Retrieves traffic statistics |

## How to Use

**Always search first** to discover exact tool names and their input schemas, then call the tool.

### Step 1: Search for the tool

```bash
agenco search-tools '{"queries":["fastly list services"]}'
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
agenco search-tools '{"queries":["fastly list services"]}'

# Call it (use the exact toolName and schema from the search result)
agenco call-tool '{"toolName":"fastly_list_services","input":{...}}'
```

> If Fastly is not connected, run `agenco list-connected-integrations` to check, then connect it via the Shield UI.
