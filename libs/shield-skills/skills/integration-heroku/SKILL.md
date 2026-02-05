---
name: integration-heroku
description: "Heroku actions available through AgentLink"
user-invocable: false
disable-model-invocation: false
---

# Heroku

Actions available through AgentLink secure gateway. All credentials are stored in the cloud vault — never exposed locally.

## Actions

| Action | Description |
|--------|-------------|
| list_apps | Retrieves Heroku applications |
| get_app | Fetches app details |
| create_app | Creates new applications |
| list_dynos | Gets running dynos |
| scale_dynos | Adjusts dyno formation |

## How to Use

**Always search first** to discover exact tool names and their input schemas, then call the tool.

### Step 1: Search for the tool

```bash
agentlink search-tools '{"queries":["heroku list apps"]}'
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
agentlink search-tools '{"queries":["heroku list apps"]}'

# Call it (use the exact toolName and schema from the search result)
agentlink call-tool '{"toolName":"heroku_list_apps","input":{...}}'
```

> If Heroku is not connected, run `agentlink list-connected-integrations` to check, then connect it via the Shield UI.
