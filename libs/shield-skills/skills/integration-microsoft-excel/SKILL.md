---
name: integration-microsoft-excel
description: "Microsoft Excel actions available through AgentLink"
user-invocable: false
disable-model-invocation: false
---

# Microsoft Excel

Actions available through AgentLink secure gateway. All credentials are stored in the cloud vault — never exposed locally.

## Actions

| Action | Description |
|--------|-------------|
| get_worksheets | Lists all worksheets in a workbook |
| get_range | Reads cell values from specified ranges |
| update_range | Writes data to specified cell ranges |
| add_worksheet | Creates new worksheets in the workbook |
| list_tables | Gets tables within worksheets for structured data |
| add_table_rows | Appends new rows to existing tables |
| get_charts | Retrieves chart configurations from worksheets |
| create_chart | Creates new charts from data ranges |

## How to Use

**Always search first** to discover exact tool names and their input schemas, then call the tool.

### Step 1: Search for the tool

```bash
agentlink search-tools '{"queries":["microsoft excel get worksheets"]}'
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
agentlink search-tools '{"queries":["microsoft excel get worksheets"]}'

# Call it (use the exact toolName and schema from the search result)
agentlink call-tool '{"toolName":"microsoft-excel_get_worksheets","input":{...}}'
```

> If Microsoft Excel is not connected, run `agentlink list-connected-integrations` to check, then connect it via the Shield UI.
