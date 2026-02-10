---
name: agenco-docusign
description: "DocuSign actions available through AgenCo"
user-invocable: false
disable-model-invocation: false
---

# DocuSign

Actions available through AgenCo secure gateway. All credentials are stored in the cloud vault — never exposed locally.

## Actions

| Action | Description |
|--------|-------------|
| create_envelope | Generates new document envelopes ready for signing |
| get_envelope | Retrieves current envelope status and details |
| list_envelopes | Queries envelopes with filtering by status or date |
| send_envelope | Transmits envelopes to recipients for signature |
| void_envelope | Cancels envelopes no longer required |
| list_recipients | Obtains signers and other envelope participants |
| list_documents | Retrieves documents contained within an envelope |
| download_document | Exports signed or completed documents |
| list_templates | Accesses available document templates |
| get_user_info | Obtains current user account information |

## How to Use

**Always search first** to discover exact tool names and their input schemas, then call the tool.

### Step 1: Search for the tool

```bash
agenco search-tools '{"queries":["docusign create envelope"]}'
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
agenco search-tools '{"queries":["docusign create envelope"]}'

# Call it (use the exact toolName and schema from the search result)
agenco call-tool '{"toolName":"docusign_create_envelope","input":{...}}'
```

> If DocuSign is not connected, run `agenco list-connected-integrations` to check, then connect it via the Shield UI.
