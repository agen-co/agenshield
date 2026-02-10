---
name: agenco-constant-contact
description: "Constant Contact actions available through AgenCo"
user-invocable: false
disable-model-invocation: false
---

# Constant Contact

Actions available through AgenCo secure gateway. All credentials are stored in the cloud vault — never exposed locally.

## Actions

| Action | Description |
|--------|-------------|
| list_contacts | Retrieves contact list |
| create_contact | Adds new contacts |
| update_contact | Modifies contact details |
| list_lists | Gets contact lists |
| list_campaigns | Retrieves email campaigns |
| create_campaign | Creates new campaigns |
| schedule_campaign | Schedules campaign delivery |

## How to Use

**Always search first** to discover exact tool names and their input schemas, then call the tool.

### Step 1: Search for the tool

```bash
agenco search-tools '{"queries":["constant contact list contacts"]}'
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
agenco search-tools '{"queries":["constant contact list contacts"]}'

# Call it (use the exact toolName and schema from the search result)
agenco call-tool '{"toolName":"constant-contact_list_contacts","input":{...}}'
```

> If Constant Contact is not connected, run `agenco list-connected-integrations` to check, then connect it via the Shield UI.
