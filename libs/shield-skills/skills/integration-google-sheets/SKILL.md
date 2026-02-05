---
name: integration-google-sheets
description: "Google Sheets actions available through AgenCo"
user-invocable: false
disable-model-invocation: false
---

# Google Sheets

Actions available through AgenCo secure gateway. All credentials are stored in the cloud vault — never exposed locally.

## Actions

| Action | Description |
|--------|-------------|
| get_spreadsheet | Retrieves spreadsheet metadata and sheet names |
| create_spreadsheet | Creates new spreadsheets with specified sheets and formatting |
| get_values | Reads cell values from specified ranges |
| update_values | Writes data to specified cell ranges |
| append_values | Adds new rows of data to existing sheets |
| clear_values | Removes data from specified cell ranges |
| batch_update | Performs multiple updates in a single request |
| add_sheet | Creates new sheets within a spreadsheet |

## How to Use

**Always search first** to discover exact tool names and their input schemas, then call the tool.

### Step 1: Search for the tool

```bash
agenco search-tools '{"queries":["google sheets get spreadsheet"]}'
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
agenco search-tools '{"queries":["google sheets get spreadsheet"]}'

# Call it (use the exact toolName and schema from the search result)
agenco call-tool '{"toolName":"google-sheets_get_spreadsheet","input":{...}}'
```

> If Google Sheets is not connected, run `agenco list-connected-integrations` to check, then connect it via the Shield UI.
