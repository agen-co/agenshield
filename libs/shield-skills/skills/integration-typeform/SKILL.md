---
name: integration-typeform
description: "Typeform actions available through AgentLink"
user-invocable: false
disable-model-invocation: false
---

# Typeform

Actions available through AgentLink secure gateway. All credentials are stored in the cloud vault — never exposed locally.

## Actions

| Action | Description |
|--------|-------------|
| list_forms | Retrieves available forms |
| get_form | Fetches form structure and questions |
| create_form | Creates new forms |
| update_form | Modifies form content |
| delete_form | Removes forms |
| list_responses | Gets form submissions |
| get_response | Fetches individual response details |
| list_workspaces | Retrieves available workspaces |

## How to Use

**Always search first** to discover exact tool names and their input schemas, then call the tool.

### Step 1: Search for the tool

```bash
agentlink search-tools '{"queries":["typeform list forms"]}'
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
agentlink search-tools '{"queries":["typeform list forms"]}'

# Call it (use the exact toolName and schema from the search result)
agentlink call-tool '{"toolName":"typeform_list_forms","input":{...}}'
```

> If Typeform is not connected, run `agentlink list-connected-integrations` to check, then connect it via the Shield UI.
