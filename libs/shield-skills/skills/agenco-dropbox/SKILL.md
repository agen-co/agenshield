---
name: agenco-dropbox
description: "Dropbox actions available through AgenCo"
user-invocable: false
disable-model-invocation: false
---

# Dropbox

Actions available through AgenCo secure gateway. All credentials are stored in the cloud vault — never exposed locally.

## Actions

| Action | Description |
|--------|-------------|
| list_files | Retrieves files and folders from Dropbox |
| download_file | Downloads file content from Dropbox |
| upload_file | Uploads new files to Dropbox locations |
| delete_file | Removes files from Dropbox |
| copy_file | Creates copies of files in specified locations |
| move_file | Relocates files between folders |
| create_folder | Creates new folders for organization |
| search_files | Searches files by name or content |
| create_shared_link | Generates shareable links for files |
| list_shared_links | Retrieves existing shared links |

## How to Use

**Always search first** to discover exact tool names and their input schemas, then call the tool.

### Step 1: Search for the tool

```bash
agenco search-tools '{"queries":["dropbox list files"]}'
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
agenco search-tools '{"queries":["dropbox list files"]}'

# Call it (use the exact toolName and schema from the search result)
agenco call-tool '{"toolName":"dropbox_list_files","input":{...}}'
```

> If Dropbox is not connected, run `agenco list-connected-integrations` to check, then connect it via the Shield UI.
