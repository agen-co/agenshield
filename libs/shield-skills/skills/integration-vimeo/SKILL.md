---
name: integration-vimeo
description: "Vimeo actions available through AgenCo"
user-invocable: false
disable-model-invocation: false
---

# Vimeo

Actions available through AgenCo secure gateway. All credentials are stored in the cloud vault — never exposed locally.

## Actions

| Action | Description |
|--------|-------------|
| list_videos | Retrieves user videos |
| get_video | Fetches video details |
| upload_video | Uploads new videos |
| update_video | Modifies video details |
| delete_video | Removes videos |

## How to Use

**Always search first** to discover exact tool names and their input schemas, then call the tool.

### Step 1: Search for the tool

```bash
agenco search-tools '{"queries":["vimeo list videos"]}'
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
agenco search-tools '{"queries":["vimeo list videos"]}'

# Call it (use the exact toolName and schema from the search result)
agenco call-tool '{"toolName":"vimeo_list_videos","input":{...}}'
```

> If Vimeo is not connected, run `agenco list-connected-integrations` to check, then connect it via the Shield UI.
