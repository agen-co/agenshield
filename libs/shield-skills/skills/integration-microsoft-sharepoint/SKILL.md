---
name: integration-microsoft-sharepoint
description: "Microsoft SharePoint actions available through AgenCo"
user-invocable: false
disable-model-invocation: false
---

# Microsoft SharePoint

Actions available through AgenCo secure gateway. All credentials are stored in the cloud vault — never exposed locally.

## Actions

| Action | Description |
|--------|-------------|
| list_sites | Retrieves SharePoint sites the user can access |
| get_site | Fetches site details and document libraries |
| list_items | Gets items from SharePoint lists |
| create_item | Adds new items to SharePoint lists |
| update_item | Modifies list item properties |
| upload_file | Uploads files to document libraries |
| download_file | Downloads files from document libraries |
| list_lists | Gets SharePoint lists in a site |
| create_list | Creates new SharePoint lists |
| get_permissions | Retrieves sharing permissions on items |

## How to Use

**Always search first** to discover exact tool names and their input schemas, then call the tool.

### Step 1: Search for the tool

```bash
agenco search-tools '{"queries":["microsoft sharepoint list sites"]}'
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
agenco search-tools '{"queries":["microsoft sharepoint list sites"]}'

# Call it (use the exact toolName and schema from the search result)
agenco call-tool '{"toolName":"microsoft-sharepoint_list_sites","input":{...}}'
```

> If Microsoft SharePoint is not connected, run `agenco list-connected-integrations` to check, then connect it via the Shield UI.
