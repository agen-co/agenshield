---
name: integration-activecampaign
description: "ActiveCampaign actions available through AgenCo"
user-invocable: false
disable-model-invocation: false
---

# ActiveCampaign

Actions available through AgenCo secure gateway. All credentials are stored in the cloud vault — never exposed locally.

## Actions

| Action | Description |
|--------|-------------|
| list_contacts | Retrieves contact list |
| get_contact | Fetches contact details |
| create_contact | Creates new contacts |
| update_contact | Modifies contact information |
| add_tag | Tags contacts for segmentation |
| list_automations | Gets marketing automations |
| add_to_automation | Enrolls contacts in automations |
| list_deals | Retrieves CRM deals |

## How to Use

**Always search first** to discover exact tool names and their input schemas, then call the tool.

### Step 1: Search for the tool

```bash
agenco search-tools '{"queries":["activecampaign list contacts"]}'
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
agenco search-tools '{"queries":["activecampaign list contacts"]}'

# Call it (use the exact toolName and schema from the search result)
agenco call-tool '{"toolName":"activecampaign_list_contacts","input":{...}}'
```

> If ActiveCampaign is not connected, run `agenco list-connected-integrations` to check, then connect it via the Shield UI.
