---
name: agenco-whatsapp-business
description: "WhatsApp Business actions available through AgenCo"
user-invocable: false
disable-model-invocation: false
---

# WhatsApp Business

Actions available through AgenCo secure gateway. All credentials are stored in the cloud vault — never exposed locally.

## Actions

| Action | Description |
|--------|-------------|
| send_text_message | Transmits text-based messages to contacts |
| send_template_message | Dispatches pre-approved message templates |
| send_media_message | Shares images, videos, or documents |
| get_message_status | Retrieves delivery and read status information |
| upload_media | Adds media files for use in messages |
| get_media | Retrieves media content from messages |
| list_templates | Displays approved message templates available for use |
| get_business_profile | Retrieves business account information and details |

## How to Use

**Always search first** to discover exact tool names and their input schemas, then call the tool.

### Step 1: Search for the tool

```bash
agenco search-tools '{"queries":["whatsapp business send text message"]}'
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
agenco search-tools '{"queries":["whatsapp business send text message"]}'

# Call it (use the exact toolName and schema from the search result)
agenco call-tool '{"toolName":"whatsapp-business_send_text_message","input":{...}}'
```

> If WhatsApp Business is not connected, run `agenco list-connected-integrations` to check, then connect it via the Shield UI.
