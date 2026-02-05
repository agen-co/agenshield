---
name: integration-youtube
description: "YouTube actions available through AgenCo"
user-invocable: false
disable-model-invocation: false
---

# YouTube

Actions available through AgenCo secure gateway. All credentials are stored in the cloud vault — never exposed locally.

## Actions

| Action | Description |
|--------|-------------|
| list_videos | Retrieves channel videos |
| upload_video | Uploads new videos to channel |
| update_video | Modifies video metadata |
| delete_video | Removes videos from channel |
| list_channels | Gets channel information |
| list_playlists | Retrieves channel playlists |
| create_playlist | Creates new playlists |

## How to Use

**Always search first** to discover exact tool names and their input schemas, then call the tool.

### Step 1: Search for the tool

```bash
agenco search-tools '{"queries":["youtube list videos"]}'
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
agenco search-tools '{"queries":["youtube list videos"]}'

# Call it (use the exact toolName and schema from the search result)
agenco call-tool '{"toolName":"youtube_list_videos","input":{...}}'
```

> If YouTube is not connected, run `agenco list-connected-integrations` to check, then connect it via the Shield UI.
