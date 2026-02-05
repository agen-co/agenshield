---
name: integration-auth0
description: "Auth0 actions available through AgenCo"
user-invocable: false
disable-model-invocation: false
---

# Auth0

Actions available through AgenCo secure gateway. All credentials are stored in the cloud vault — never exposed locally.

## Actions

| Action | Description |
|--------|-------------|
| list_users | Retrieves user accounts |
| get_user | Fetches user profile and metadata |
| create_user | Creates new user accounts |
| update_user | Modifies user information |
| delete_user | Removes user accounts |
| list_organizations | Gets organizations for B2B scenarios |
| list_roles | Retrieves role definitions |
| assign_role | Assigns roles to users |

## How to Use

**Always search first** to discover exact tool names and their input schemas, then call the tool.

### Step 1: Search for the tool

```bash
agenco search-tools '{"queries":["auth0 list users"]}'
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
agenco search-tools '{"queries":["auth0 list users"]}'

# Call it (use the exact toolName and schema from the search result)
agenco call-tool '{"toolName":"auth0_list_users","input":{...}}'
```

> If Auth0 is not connected, run `agenco list-connected-integrations` to check, then connect it via the Shield UI.
