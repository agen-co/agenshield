---
name: integration-gmail
description: "Gmail actions available through AgenCo"
user-invocable: false
disable-model-invocation: false
---

# Gmail

Actions available through AgenCo secure gateway. All credentials are stored in the cloud vault — never exposed locally.

## Actions

| Action | Description |
|--------|-------------|
| list_messages | Retrieves emails from inbox with filtering by date, sender, or labels |
| get_message | Fetches the full content of a specific email including attachments |
| send_message | Composes and sends new emails to specified recipients |
| delete_message | Permanently removes emails from the mailbox |
| modify_message | Updates email labels, marks as read/unread, or archives messages |
| list_threads | Retrieves email conversation threads for context and history |
| list_labels | Gets available email labels and folders for organization |
| create_label | Creates new labels to organize and categorize emails |
| create_draft | Saves email drafts for later editing and sending |
| send_draft | Sends a previously saved email draft |

## How to Use

**Always search first** to discover exact tool names and their input schemas, then call the tool.

### Step 1: Search for the tool

```bash
agenco search-tools '{"queries":["gmail list messages"]}'
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
agenco search-tools '{"queries":["gmail list messages"]}'

# Call it (use the exact toolName and schema from the search result)
agenco call-tool '{"toolName":"gmail_list_messages","input":{...}}'
```

> If Gmail is not connected, run `agenco list-connected-integrations` to check, then connect it via the Shield UI.
