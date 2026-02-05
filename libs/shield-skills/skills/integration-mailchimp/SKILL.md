---
name: integration-mailchimp
description: "Mailchimp actions available through AgentLink"
user-invocable: false
disable-model-invocation: false
---

# Mailchimp

Actions available through AgentLink secure gateway. All credentials are stored in the cloud vault — never exposed locally.

## Actions

| Action | Description |
|--------|-------------|
| list_audiences | Retrieves mailing lists and audiences |
| get_audience | Fetches audience details and statistics |
| add_subscriber | Adds new subscribers to audiences |
| get_subscriber | Retrieves subscriber information and activity |
| update_subscriber | Modifies subscriber details and preferences |
| list_campaigns | Gets email campaigns with status |
| create_campaign | Creates new email campaigns |
| send_campaign | Sends campaigns to audiences |
| get_campaign_report | Retrieves campaign performance metrics |
| list_templates | Gets email templates for campaigns |

## How to Use

**Always search first** to discover exact tool names and their input schemas, then call the tool.

### Step 1: Search for the tool

```bash
agentlink search-tools '{"queries":["mailchimp list audiences"]}'
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
agentlink search-tools '{"queries":["mailchimp list audiences"]}'

# Call it (use the exact toolName and schema from the search result)
agentlink call-tool '{"toolName":"mailchimp_list_audiences","input":{...}}'
```

> If Mailchimp is not connected, run `agentlink list-connected-integrations` to check, then connect it via the Shield UI.
