---
name: integration-contentful
description: "Contentful actions available through AgenCo"
user-invocable: false
disable-model-invocation: false
---

# Contentful

Actions available through AgenCo secure gateway. All credentials are stored in the cloud vault — never exposed locally.

## Actions

| Action | Description |
|--------|-------------|
| list_spaces | Retrieves content spaces |
| get_space | Fetches space details |
| list_content_types | Gets content type schemas |
| list_entries | Retrieves content entries |
| get_entry | Fetches entry content |
| create_entry | Creates new content entries |
| update_entry | Modifies entry content |
| delete_entry | Removes content entries |

## How to Use

**Always search first** to discover exact tool names and their input schemas, then call the tool.

### Step 1: Search for the tool

```bash
agenco search-tools '{"queries":["contentful list spaces"]}'
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
agenco search-tools '{"queries":["contentful list spaces"]}'

# Call it (use the exact toolName and schema from the search result)
agenco call-tool '{"toolName":"contentful_list_spaces","input":{...}}'
```

> If Contentful is not connected, run `agenco list-connected-integrations` to check, then connect it via the Shield UI.
