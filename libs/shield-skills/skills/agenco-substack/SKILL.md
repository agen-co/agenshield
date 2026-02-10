---
name: agenco-substack
description: "Substack actions available through AgenCo"
user-invocable: false
disable-model-invocation: false
---

# Substack

Actions available through AgenCo secure gateway. All credentials are stored in the cloud vault — never exposed locally.

## Actions

| Action | Description |
|--------|-------------|
| get_publication | Retrieves publication details |
| list_posts | Gets published posts |
| create_post | Creates new newsletter posts |
| update_post | Modifies post content |
| publish_post | Publishes draft posts |
| list_subscribers | Retrieves subscriber list |
| get_analytics | Gets publication metrics |

## How to Use

**Always search first** to discover exact tool names and their input schemas, then call the tool.

### Step 1: Search for the tool

```bash
agenco search-tools '{"queries":["substack get publication"]}'
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
agenco search-tools '{"queries":["substack get publication"]}'

# Call it (use the exact toolName and schema from the search result)
agenco call-tool '{"toolName":"substack_get_publication","input":{...}}'
```

> If Substack is not connected, run `agenco list-connected-integrations` to check, then connect it via the Shield UI.
