---
name: integration-adobe-creative-cloud
description: "Adobe Creative Cloud actions available through AgenCo"
user-invocable: false
disable-model-invocation: false
---

# Adobe Creative Cloud

Actions available through AgenCo secure gateway. All credentials are stored in the cloud vault — never exposed locally.

## Actions

| Action | Description |
|--------|-------------|
| list_libraries | Retrieves Creative Cloud libraries |
| get_library | Fetches library contents |
| create_library | Creates new libraries |
| list_elements | Gets library elements |
| create_element | Adds elements to libraries |

## How to Use

**Always search first** to discover exact tool names and their input schemas, then call the tool.

### Step 1: Search for the tool

```bash
agenco search-tools '{"queries":["adobe creative cloud list libraries"]}'
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
agenco search-tools '{"queries":["adobe creative cloud list libraries"]}'

# Call it (use the exact toolName and schema from the search result)
agenco call-tool '{"toolName":"adobe-creative-cloud_list_libraries","input":{...}}'
```

> If Adobe Creative Cloud is not connected, run `agenco list-connected-integrations` to check, then connect it via the Shield UI.
