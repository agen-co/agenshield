---
name: agenco-linode
description: "Linode actions available through AgenCo"
user-invocable: false
disable-model-invocation: false
---

# Linode

Actions available through AgenCo secure gateway. All credentials are stored in the cloud vault — never exposed locally.

## Actions

| Action | Description |
|--------|-------------|
| list_instances | Retrieves Linode instances |
| get_instance | Fetches instance details |
| create_instance | Creates new instances |
| delete_instance | Removes instances |
| list_volumes | Gets block storage |

## How to Use

**Always search first** to discover exact tool names and their input schemas, then call the tool.

### Step 1: Search for the tool

```bash
agenco search-tools '{"queries":["linode list instances"]}'
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
agenco search-tools '{"queries":["linode list instances"]}'

# Call it (use the exact toolName and schema from the search result)
agenco call-tool '{"toolName":"linode_list_instances","input":{...}}'
```

> If Linode is not connected, run `agenco list-connected-integrations` to check, then connect it via the Shield UI.
