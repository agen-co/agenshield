---
name: agenco-pipedrive
description: "Pipedrive actions available through AgenCo"
user-invocable: false
disable-model-invocation: false
---

# Pipedrive

Actions available through AgenCo secure gateway. All credentials are stored in the cloud vault — never exposed locally.

## Actions

| Action | Description |
|--------|-------------|
| list_deals | Retrieves sales deals from the pipeline |
| get_deal | Fetches individual deal details and history |
| create_deal | Adds new deals to the sales pipeline |
| update_deal | Modifies deal stage or financial value |
| list_persons | Retrieves contact records in the system |
| create_person | Adds new contact records |
| list_organizations | Gets company records |
| list_activities | Retrieves scheduled activities and tasks |
| create_activity | Adds new activities and task assignments |

## How to Use

**Always search first** to discover exact tool names and their input schemas, then call the tool.

### Step 1: Search for the tool

```bash
agenco search-tools '{"queries":["pipedrive list deals"]}'
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
agenco search-tools '{"queries":["pipedrive list deals"]}'

# Call it (use the exact toolName and schema from the search result)
agenco call-tool '{"toolName":"pipedrive_list_deals","input":{...}}'
```

> If Pipedrive is not connected, run `agenco list-connected-integrations` to check, then connect it via the Shield UI.
