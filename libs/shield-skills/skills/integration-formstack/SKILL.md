---
name: integration-formstack
description: "Formstack actions available through AgenCo"
user-invocable: false
disable-model-invocation: false
---

# Formstack

Actions available through AgenCo secure gateway. All credentials are stored in the cloud vault — never exposed locally.

## Actions

| Action | Description |
|--------|-------------|
| list_forms | Retrieves available forms |
| get_form | Fetches form details |
| create_form | Creates new forms |
| list_submissions | Gets form submissions |
| get_submission | Fetches individual submission details |
| list_fields | Gets form fields and structure |

## How to Use

**Always search first** to discover exact tool names and their input schemas, then call the tool.

### Step 1: Search for the tool

```bash
agenco search-tools '{"queries":["formstack list forms"]}'
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
agenco search-tools '{"queries":["formstack list forms"]}'

# Call it (use the exact toolName and schema from the search result)
agenco call-tool '{"toolName":"formstack_list_forms","input":{...}}'
```

> If Formstack is not connected, run `agenco list-connected-integrations` to check, then connect it via the Shield UI.
