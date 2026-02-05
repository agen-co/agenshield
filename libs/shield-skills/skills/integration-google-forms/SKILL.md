---
name: integration-google-forms
description: "Google Forms actions available through AgenCo"
user-invocable: false
disable-model-invocation: false
---

# Google Forms

Actions available through AgenCo secure gateway. All credentials are stored in the cloud vault — never exposed locally.

## Actions

| Action | Description |
|--------|-------------|
| get_form | Retrieves form structure and questions |
| create_form | Creates new Google Forms |
| update_form | Modifies form content and settings |
| list_responses | Gets form submissions |
| get_response | Fetches individual response details |
| add_item | Adds questions to forms |

## How to Use

**Always search first** to discover exact tool names and their input schemas, then call the tool.

### Step 1: Search for the tool

```bash
agenco search-tools '{"queries":["google forms get form"]}'
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
agenco search-tools '{"queries":["google forms get form"]}'

# Call it (use the exact toolName and schema from the search result)
agenco call-tool '{"toolName":"google-forms_get_form","input":{...}}'
```

> If Google Forms is not connected, run `agenco list-connected-integrations` to check, then connect it via the Shield UI.
