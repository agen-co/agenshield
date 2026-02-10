---
name: agenco-vercel
description: "Vercel actions available through AgenCo"
user-invocable: false
disable-model-invocation: false
---

# Vercel

Actions available through AgenCo secure gateway. All credentials are stored in the cloud vault — never exposed locally.

## Actions

| Action | Description |
|--------|-------------|
| list_projects | Retrieves Vercel projects |
| get_project | Fetches project details |
| create_project | Creates new projects |
| list_deployments | Gets project deployments |
| create_deployment | Triggers new deployments |
| list_domains | Retrieves configured domains |
| get_current_user | Gets authenticated user info |

## How to Use

**Always search first** to discover exact tool names and their input schemas, then call the tool.

### Step 1: Search for the tool

```bash
agenco search-tools '{"queries":["vercel list projects"]}'
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
agenco search-tools '{"queries":["vercel list projects"]}'

# Call it (use the exact toolName and schema from the search result)
agenco call-tool '{"toolName":"vercel_list_projects","input":{...}}'
```

> If Vercel is not connected, run `agenco list-connected-integrations` to check, then connect it via the Shield UI.
