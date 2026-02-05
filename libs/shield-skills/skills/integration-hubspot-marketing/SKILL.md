---
name: integration-hubspot-marketing
description: "HubSpot Marketing actions available through AgentLink"
user-invocable: false
disable-model-invocation: false
---

# HubSpot Marketing

Actions available through AgentLink secure gateway. All credentials are stored in the cloud vault — never exposed locally.

## Actions

| Action | Description |
|--------|-------------|
| list_forms | Retrieves marketing forms from HubSpot |
| get_form | Fetches form details and submissions |
| create_form | Creates new marketing forms |
| list_emails | Gets marketing email campaigns |
| create_email | Creates new marketing emails |
| send_email | Sends marketing emails to lists |
| list_campaigns | Retrieves marketing campaigns |
| get_campaign | Fetches campaign details and metrics |
| list_landing_pages | Gets landing pages with performance data |
| create_social_post | Schedules social media posts |

## How to Use

**Always search first** to discover exact tool names and their input schemas, then call the tool.

### Step 1: Search for the tool

```bash
agentlink search-tools '{"queries":["hubspot marketing list forms"]}'
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
agentlink search-tools '{"queries":["hubspot marketing list forms"]}'

# Call it (use the exact toolName and schema from the search result)
agentlink call-tool '{"toolName":"hubspot-marketing_list_forms","input":{...}}'
```

> If HubSpot Marketing is not connected, run `agentlink list-connected-integrations` to check, then connect it via the Shield UI.
