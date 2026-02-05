---
name: integration-figma
description: "Figma actions available through AgenCo"
user-invocable: false
disable-model-invocation: false
---

# Figma

Actions available through AgenCo secure gateway. All credentials are stored in the cloud vault — never exposed locally.

## Actions

| Action | Description |
|--------|-------------|
| get_file | Retrieves Figma file content and structure |
| list_projects | Gets team projects |
| get_project_files | Lists files within projects |
| list_comments | Retrieves file comments |
| create_comment | Posts comments on files |

## How to Use

**Always search first** to discover exact tool names and their input schemas, then call the tool.

### Step 1: Search for the tool

```bash
agenco search-tools '{"queries":["figma get file"]}'
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
agenco search-tools '{"queries":["figma get file"]}'

# Call it (use the exact toolName and schema from the search result)
agenco call-tool '{"toolName":"figma_get_file","input":{...}}'
```

> If Figma is not connected, run `agenco list-connected-integrations` to check, then connect it via the Shield UI.
