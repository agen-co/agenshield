---
name: integration-google-drive
description: "Google Drive actions available through AgentLink"
user-invocable: false
disable-model-invocation: false
---

# Google Drive

Actions available through AgentLink secure gateway. All credentials are stored in the cloud vault — never exposed locally.

## Actions

| Action | Description |
|--------|-------------|
| list_files | Retrieves files and folders from Drive with search filters |
| get_file | Fetches file metadata and content details |
| create_file | Uploads new files to Drive with folder placement |
| update_file | Modifies file content or metadata |
| delete_file | Removes files from Drive or moves to trash |
| copy_file | Creates copies of files in specified locations |
| export_file | Exports Google Docs to different formats like PDF or Word |
| list_permissions | Gets sharing settings and access permissions |
| create_permission | Shares files with users or groups with specified access levels |

## How to Use

**Always search first** to discover exact tool names and their input schemas, then call the tool.

### Step 1: Search for the tool

```bash
agentlink search-tools '{"queries":["google drive list files"]}'
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
agentlink search-tools '{"queries":["google drive list files"]}'

# Call it (use the exact toolName and schema from the search result)
agentlink call-tool '{"toolName":"google-drive_list_files","input":{...}}'
```

> If Google Drive is not connected, run `agentlink list-connected-integrations` to check, then connect it via the Shield UI.
