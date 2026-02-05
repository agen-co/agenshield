---
name: integration-cloudflare
description: "Cloudflare actions available through AgentLink"
user-invocable: false
disable-model-invocation: false
---

# Cloudflare

Actions available through AgentLink secure gateway. All credentials are stored in the cloud vault — never exposed locally.

## Actions

| Action | Description |
|--------|-------------|
| list_zones | Retrieves managed domains |
| get_zone | Fetches zone details |
| list_dns_records | Gets DNS configurations |
| create_dns_record | Adds new DNS records |
| update_dns_record | Modifies DNS records |
| delete_dns_record | Removes DNS records |
| purge_cache | Clears cached content |
| get_analytics | Retrieves traffic analytics |

## How to Use

**Always search first** to discover exact tool names and their input schemas, then call the tool.

### Step 1: Search for the tool

```bash
agentlink search-tools '{"queries":["cloudflare list zones"]}'
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
agentlink search-tools '{"queries":["cloudflare list zones"]}'

# Call it (use the exact toolName and schema from the search result)
agentlink call-tool '{"toolName":"cloudflare_list_zones","input":{...}}'
```

> If Cloudflare is not connected, run `agentlink list-connected-integrations` to check, then connect it via the Shield UI.
