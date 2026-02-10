---
name: agenco-microsoft-onedrive
description: "Microsoft OneDrive actions available through AgenCo"
user-invocable: false
disable-model-invocation: false
---

# Microsoft OneDrive

Actions available through AgenCo secure gateway. All credentials are stored in the cloud vault — never exposed locally.

## Actions

| Action | Description |
|--------|-------------|
| list_files | Retrieves files and folders from OneDrive |
| get_file | Fetches file content and metadata |
| upload_file | Uploads new files to OneDrive locations |
| download_file | Downloads file content for local use |
| delete_file | Removes files from OneDrive |
| copy_file | Creates copies of files in specified folders |
| move_file | Relocates files between folders |
| create_folder | Creates new folders for file organization |
| search_files | Searches files by name or content |
| create_sharing_link | Generates shareable links with access permissions |

## How to Use

**Always search first** to discover exact tool names and their input schemas, then call the tool.

### Step 1: Search for the tool

```bash
agenco search-tools '{"queries":["microsoft onedrive list files"]}'
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
agenco search-tools '{"queries":["microsoft onedrive list files"]}'

# Call it (use the exact toolName and schema from the search result)
agenco call-tool '{"toolName":"microsoft-onedrive_list_files","input":{...}}'
```

> If Microsoft OneDrive is not connected, run `agenco list-connected-integrations` to check, then connect it via the Shield UI.
