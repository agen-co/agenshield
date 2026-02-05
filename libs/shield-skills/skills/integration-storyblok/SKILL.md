---
name: integration-storyblok
description: "Storyblok actions available through AgentLink"
user-invocable: false
disable-model-invocation: false
---

# Storyblok

Actions available through AgentLink secure gateway. All credentials are stored in the cloud vault — never exposed locally.

## Actions

| Action | Description |
|--------|-------------|
| list_spaces | Retrieves content spaces |
| get_space | Fetches space details |
| list_stories | Gets content stories |
| get_story | Fetches story content |
| create_story | Creates new stories |
| update_story | Modifies story content |
| publish_story | Publishes story changes |
| list_components | Gets component schemas |

## How to Use

**Always search first** to discover exact tool names and their input schemas, then call the tool.

### Step 1: Search for the tool

```bash
agentlink search-tools '{"queries":["storyblok list spaces"]}'
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
agentlink search-tools '{"queries":["storyblok list spaces"]}'

# Call it (use the exact toolName and schema from the search result)
agentlink call-tool '{"toolName":"storyblok_list_spaces","input":{...}}'
```

> If Storyblok is not connected, run `agentlink list-connected-integrations` to check, then connect it via the Shield UI.
