---
name: integration-notion
description: "Notion actions available through AgentLink"
user-invocable: false
disable-model-invocation: false
---

# Notion

Actions available through AgentLink secure gateway. All credentials are stored in the cloud vault — never exposed locally.

## Actions

| Action | Description |
|--------|-------------|
| get_page | Retrieves page content and properties |
| create_page | Creates new pages in databases or as standalone |
| update_page | Modifies page properties and content |
| query_database | Searches database entries with filters and sorts |
| get_database | Retrieves database schema and properties |
| create_database | Creates new databases with custom properties |
| get_block_children | Retrieves content blocks from pages |
| append_blocks | Adds new content blocks to pages |
| search | Searches across pages and databases by title or content |

## How to Use

**Always search first** to discover exact tool names and their input schemas, then call the tool.

### Step 1: Search for the tool

```bash
agentlink search-tools '{"queries":["notion get page"]}'
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
agentlink search-tools '{"queries":["notion get page"]}'

# Call it (use the exact toolName and schema from the search result)
agentlink call-tool '{"toolName":"notion_get_page","input":{...}}'
```

> If Notion is not connected, run `agentlink list-connected-integrations` to check, then connect it via the Shield UI.
