---
name: agenco-box
description: "Box actions available through AgenCo"
user-invocable: false
disable-model-invocation: false
---

# Box

Actions available through AgenCo secure gateway. All credentials are stored in the cloud vault — never exposed locally.

## Actions

| Action | Description |
|--------|-------------|
| get_user | Retrieves current user information |
| list_files | Gets files in folders |
| get_file_info | Fetches file metadata |
| upload_file | Uploads new files to Box |
| download_file | Downloads file content |
| delete_file | Removes files from Box |
| create_folder | Creates new folders |
| list_folder_items | Gets contents of folders |
| create_collaboration | Shares files and folders with users |

## How to Use

**Always search first** to discover exact tool names and their input schemas, then call the tool.

### Step 1: Search for the tool

```bash
agenco search-tools '{"queries":["box get user"]}'
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
agenco search-tools '{"queries":["box get user"]}'

# Call it (use the exact toolName and schema from the search result)
agenco call-tool '{"toolName":"box_get_user","input":{...}}'
```

> If Box is not connected, run `agenco list-connected-integrations` to check, then connect it via the Shield UI.
