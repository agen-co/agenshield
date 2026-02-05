---
name: integration-netlify
description: "Netlify actions available through AgentLink"
user-invocable: false
disable-model-invocation: false
---

# Netlify

Actions available through AgentLink secure gateway. All credentials are stored in the cloud vault — never exposed locally.

## Actions

| Action | Description |
|--------|-------------|
| list_sites | Retrieves Netlify sites |
| get_site | Fetches site details |
| create_site | Creates new sites |
| list_deploys | Gets site deployments |
| trigger_deploy | Initiates new deployments |

## How to Use

**Always search first** to discover exact tool names and their input schemas, then call the tool.

### Step 1: Search for the tool

```bash
agentlink search-tools '{"queries":["netlify list sites"]}'
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
agentlink search-tools '{"queries":["netlify list sites"]}'

# Call it (use the exact toolName and schema from the search result)
agentlink call-tool '{"toolName":"netlify_list_sites","input":{...}}'
```

> If Netlify is not connected, run `agentlink list-connected-integrations` to check, then connect it via the Shield UI.
