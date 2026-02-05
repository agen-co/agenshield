---
name: integration-sanity
description: "Sanity actions available through AgentLink"
user-invocable: false
disable-model-invocation: false
---

# Sanity

Actions available through AgentLink secure gateway. All credentials are stored in the cloud vault — never exposed locally.

## Actions

| Action | Description |
|--------|-------------|
| list_projects | Retrieves Sanity projects |
| get_project | Fetches project details |
| query_documents | Queries content with GROQ |
| get_document | Fetches individual document |
| create_document | Creates new documents |
| update_document | Modifies document content |
| delete_document | Removes documents |

## How to Use

**Always search first** to discover exact tool names and their input schemas, then call the tool.

### Step 1: Search for the tool

```bash
agentlink search-tools '{"queries":["sanity list projects"]}'
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
agentlink search-tools '{"queries":["sanity list projects"]}'

# Call it (use the exact toolName and schema from the search result)
agentlink call-tool '{"toolName":"sanity_list_projects","input":{...}}'
```

> If Sanity is not connected, run `agentlink list-connected-integrations` to check, then connect it via the Shield UI.
