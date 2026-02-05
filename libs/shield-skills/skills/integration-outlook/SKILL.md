---
name: integration-outlook
description: "Outlook actions available through AgentLink"
user-invocable: false
disable-model-invocation: false
---

# Outlook

Actions available through AgentLink secure gateway. All credentials are stored in the cloud vault — never exposed locally.

## Actions

| Action | Description |
|--------|-------------|
| list_messages | Retrieves emails from mailbox with filters for folder, sender, or date |
| get_message | Fetches complete email content including body and attachments |
| send_message | Composes and sends new emails with formatting and attachments |
| reply_to_message | Sends replies to existing email threads |
| forward_message | Forwards emails to additional recipients |
| move_message | Moves emails between folders for organization |
| create_draft | Saves email drafts for later completion |
| list_folders | Gets mailbox folders for email organization and filtering |
| get_mailbox_settings | Retrieves mailbox configuration and automatic replies |
| list_contacts | Retrieves contact information from the address book |

## How to Use

**Always search first** to discover exact tool names and their input schemas, then call the tool.

### Step 1: Search for the tool

```bash
agentlink search-tools '{"queries":["outlook list messages"]}'
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
agentlink search-tools '{"queries":["outlook list messages"]}'

# Call it (use the exact toolName and schema from the search result)
agentlink call-tool '{"toolName":"outlook_list_messages","input":{...}}'
```

> If Outlook is not connected, run `agentlink list-connected-integrations` to check, then connect it via the Shield UI.
