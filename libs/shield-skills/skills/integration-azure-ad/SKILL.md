---
name: integration-azure-ad
description: "Azure AD actions available through AgenCo"
user-invocable: false
disable-model-invocation: false
---

# Azure AD

Actions available through AgenCo secure gateway. All credentials are stored in the cloud vault — never exposed locally.

## Actions

| Action | Description |
|--------|-------------|
| list_users | Retrieves directory users |
| get_user | Fetches user profile and groups |
| create_user | Creates new user accounts |
| list_groups | Gets security and Microsoft 365 groups |
| create_group | Creates new groups |
| add_group_member | Adds users to groups |
| list_applications | Retrieves registered applications |
| list_directory_roles | Gets available directory roles |

## How to Use

**Always search first** to discover exact tool names and their input schemas, then call the tool.

### Step 1: Search for the tool

```bash
agenco search-tools '{"queries":["azure ad list users"]}'
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
agenco search-tools '{"queries":["azure ad list users"]}'

# Call it (use the exact toolName and schema from the search result)
agenco call-tool '{"toolName":"azure-ad_list_users","input":{...}}'
```

> If Azure AD is not connected, run `agenco list-connected-integrations` to check, then connect it via the Shield UI.
