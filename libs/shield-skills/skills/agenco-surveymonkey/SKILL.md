---
name: agenco-surveymonkey
description: "SurveyMonkey actions available through AgenCo"
user-invocable: false
disable-model-invocation: false
---

# SurveyMonkey

Actions available through AgenCo secure gateway. All credentials are stored in the cloud vault — never exposed locally.

## Actions

| Action | Description |
|--------|-------------|
| list_surveys | Retrieves available surveys from your account |
| get_survey | Fetches survey details and associated questions |
| create_survey | Creates new surveys |
| list_responses | Gets survey responses and submission data |
| get_response | Fetches individual response details |
| list_collectors | Gets survey distribution methods |
| create_collector | Creates new collectors for survey distribution |

## How to Use

**Always search first** to discover exact tool names and their input schemas, then call the tool.

### Step 1: Search for the tool

```bash
agenco search-tools '{"queries":["surveymonkey list surveys"]}'
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
agenco search-tools '{"queries":["surveymonkey list surveys"]}'

# Call it (use the exact toolName and schema from the search result)
agenco call-tool '{"toolName":"surveymonkey_list_surveys","input":{...}}'
```

> If SurveyMonkey is not connected, run `agenco list-connected-integrations` to check, then connect it via the Shield UI.
