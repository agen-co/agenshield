---
name: integration-google-docs
description: "Google Docs actions available through AgenCo"
user-invocable: false
disable-model-invocation: false
---

# Google Docs

Actions available through AgenCo secure gateway. All credentials are stored in the cloud vault — never exposed locally.

## Actions

| Action | Description |
|--------|-------------|
| get_document | Retrieves document content and structure |
| create_document | Creates new Google Docs documents |
| update_document | Modifies document content and formatting |
| insert_text | Adds text at specified locations |
| delete_content | Removes content from documents |
| update_text_style | Changes text formatting and styles |
| insert_image | Adds images to documents |
| insert_table | Creates tables in documents |
| export_document | Exports documents to PDF or other formats |

## How to Use

**Always search first** to discover exact tool names and their input schemas, then call the tool.

### Step 1: Search for the tool

```bash
agenco search-tools '{"queries":["google docs get document"]}'
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
agenco search-tools '{"queries":["google docs get document"]}'

# Call it (use the exact toolName and schema from the search result)
agenco call-tool '{"toolName":"google-docs_get_document","input":{...}}'
```

> If Google Docs is not connected, run `agenco list-connected-integrations` to check, then connect it via the Shield UI.
