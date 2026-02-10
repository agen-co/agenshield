---
name: agenco-thousandeyes
description: "ThousandEyes actions available through AgenCo"
user-invocable: false
disable-model-invocation: false
---

# ThousandEyes

Actions available through AgenCo secure gateway. All credentials are stored in the cloud vault — never exposed locally.

## Actions

| Action | Description |
|--------|-------------|
| list_tests | Retrieves monitoring tests |
| get_test | Fetches test details |
| create_test | Creates new tests |
| get_results | Retrieves test results |

## How to Use

**Always search first** to discover exact tool names and their input schemas, then call the tool.

### Step 1: Search for the tool

```bash
agenco search-tools '{"queries":["thousandeyes list tests"]}'
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
agenco search-tools '{"queries":["thousandeyes list tests"]}'

# Call it (use the exact toolName and schema from the search result)
agenco call-tool '{"toolName":"thousandeyes_list_tests","input":{...}}'
```

> If ThousandEyes is not connected, run `agenco list-connected-integrations` to check, then connect it via the Shield UI.
