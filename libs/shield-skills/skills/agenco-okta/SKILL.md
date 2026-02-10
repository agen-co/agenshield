---
name: agenco-okta
description: "Okta actions available through AgenCo"
user-invocable: false
disable-model-invocation: false
---

# Okta

Actions available through AgenCo secure gateway. All credentials are stored in the cloud vault — never exposed locally.

## Actions

| Action | Description |
|--------|-------------|
| list_users | Retrieves user accounts in the directory |
| get_user | Fetches user profile and group membership |
| create_user | Creates new user accounts |
| update_user | Modifies user profile information |
| deactivate_user | Disables user accounts |
| list_groups | Gets groups for access management |
| add_user_to_group | Assigns users to groups |
| list_applications | Retrieves configured applications |
| get_system_logs | Retrieves security and audit logs |

## How to Use

**Always search first** to discover exact tool names and their input schemas, then call the tool.

### Step 1: Search for the tool

```bash
agenco search-tools '{"queries":["okta list users"]}'
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
agenco search-tools '{"queries":["okta list users"]}'

# Call it (use the exact toolName and schema from the search result)
agenco call-tool '{"toolName":"okta_list_users","input":{...}}'
```

> If Okta is not connected, run `agenco list-connected-integrations` to check, then connect it via the Shield UI.
