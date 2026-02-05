---
name: integration-brevo
description: "Brevo actions available through AgenCo"
user-invocable: false
disable-model-invocation: false
---

# Brevo

Actions available through AgenCo secure gateway. All credentials are stored in the cloud vault — never exposed locally.

## Actions

| Action | Description |
|--------|-------------|
| list_contacts | Retrieves contact list |
| get_contact | Fetches contact details |
| create_contact | Creates new contacts |
| update_contact | Modifies contact information |
| list_campaigns | Gets email campaigns |
| create_campaign | Creates new campaigns |
| send_campaign | Sends email campaigns |
| list_templates | Retrieves email templates |

## How to Use

**Always search first** to discover exact tool names and their input schemas, then call the tool.

### Step 1: Search for the tool

```bash
agenco search-tools '{"queries":["brevo list contacts"]}'
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
agenco search-tools '{"queries":["brevo list contacts"]}'

# Call it (use the exact toolName and schema from the search result)
agenco call-tool '{"toolName":"brevo_list_contacts","input":{...}}'
```

> If Brevo is not connected, run `agenco list-connected-integrations` to check, then connect it via the Shield UI.
