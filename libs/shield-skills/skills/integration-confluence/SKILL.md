---
name: integration-confluence
description: "Confluence actions available through AgentLink"
user-invocable: false
disable-model-invocation: false
---

# Confluence

Actions available through AgentLink secure gateway. All credentials are stored in the cloud vault — never exposed locally.

## Actions

| Action | Description |
|--------|-------------|
| get_page | Retrieves page content and metadata from Confluence spaces |
| create_page | Adds new pages to Confluence spaces |
| update_page | Modifies existing page content and properties |
| delete_page | Removes pages from Confluence spaces |
| search_content | Finds pages and blog posts by searching content |
| list_spaces | Retrieves available spaces within the instance |
| get_space | Obtains detailed space information and permissions |
| list_page_children | Gets child pages under a parent page |
| add_label | Tags pages with labels for organization purposes |
| get_current_user | Retrieves authenticated user information |

## How to Use

**Always search first** to discover exact tool names and their input schemas, then call the tool.

### Step 1: Search for the tool

```bash
agentlink search-tools '{"queries":["confluence get page"]}'
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
agentlink search-tools '{"queries":["confluence get page"]}'

# Call it (use the exact toolName and schema from the search result)
agentlink call-tool '{"toolName":"confluence_get_page","input":{...}}'
```

> If Confluence is not connected, run `agentlink list-connected-integrations` to check, then connect it via the Shield UI.
