---
name: integration-launchdarkly
description: "LaunchDarkly actions available through AgenCo"
user-invocable: false
disable-model-invocation: false
---

# LaunchDarkly

Actions available through AgenCo secure gateway. All credentials are stored in the cloud vault — never exposed locally.

## Actions

| Action | Description |
|--------|-------------|
| list_flags | Retrieves feature flags |
| get_flag | Fetches flag configuration |
| create_flag | Creates new feature flags |
| update_flag | Modifies flag settings |
| delete_flag | Removes feature flags |
| list_projects | Gets projects |
| list_environments | Retrieves environments |

## How to Use

**Always search first** to discover exact tool names and their input schemas, then call the tool.

### Step 1: Search for the tool

```bash
agenco search-tools '{"queries":["launchdarkly list flags"]}'
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
agenco search-tools '{"queries":["launchdarkly list flags"]}'

# Call it (use the exact toolName and schema from the search result)
agenco call-tool '{"toolName":"launchdarkly_list_flags","input":{...}}'
```

> If LaunchDarkly is not connected, run `agenco list-connected-integrations` to check, then connect it via the Shield UI.
