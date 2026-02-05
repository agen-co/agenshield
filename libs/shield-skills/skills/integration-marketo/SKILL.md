---
name: integration-marketo
description: "Marketo actions available through AgentLink"
user-invocable: false
disable-model-invocation: false
---

# Marketo

Actions available through AgentLink secure gateway. All credentials are stored in the cloud vault — never exposed locally.

## Actions

| Action | Description |
|--------|-------------|
| list_leads | Retrieves lead records from Marketo |
| get_lead | Fetches detailed information about a specific lead |
| create_lead | Adds new lead records to the system |
| update_lead | Modifies existing lead information |
| list_programs | Retrieves available marketing programs |
| trigger_campaign | Activates smart campaigns |
| list_activities | Retrieves historical lead activity records |

## How to Use

**Always search first** to discover exact tool names and their input schemas, then call the tool.

### Step 1: Search for the tool

```bash
agentlink search-tools '{"queries":["marketo list leads"]}'
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
agentlink search-tools '{"queries":["marketo list leads"]}'

# Call it (use the exact toolName and schema from the search result)
agentlink call-tool '{"toolName":"marketo_list_leads","input":{...}}'
```

> If Marketo is not connected, run `agentlink list-connected-integrations` to check, then connect it via the Shield UI.
