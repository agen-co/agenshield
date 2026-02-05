---
name: integration-jira-cloud
description: "Jira Cloud actions available through AgentLink"
user-invocable: false
disable-model-invocation: false
---

# Jira Cloud

Actions available through AgentLink secure gateway. All credentials are stored in the cloud vault — never exposed locally.

## Actions

| Action | Description |
|--------|-------------|
| search_issues | Searches for issues using JQL queries to find relevant tasks and bugs |
| get_issue | Retrieves detailed information about a specific issue including comments and history |
| create_issue | Creates new issues with summary, description, priority, and assignee |
| update_issue | Modifies issue fields like status, assignee, priority, or custom fields |
| delete_issue | Permanently removes an issue from the project |
| assign_issue | Changes the assignee of an issue to a different team member |
| transition_issue | Moves an issue through workflow states like To Do, In Progress, Done |
| add_comment | Adds comments to issues for updates and collaboration |
| search_projects | Lists available projects to find relevant boards and backlogs |
| get_current_user | Retrieves information about the authenticated user |

## How to Use

**Always search first** to discover exact tool names and their input schemas, then call the tool.

### Step 1: Search for the tool

```bash
agentlink search-tools '{"queries":["jira cloud search issues"]}'
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
agentlink search-tools '{"queries":["jira cloud search issues"]}'

# Call it (use the exact toolName and schema from the search result)
agentlink call-tool '{"toolName":"jira-cloud_search_issues","input":{...}}'
```

> If Jira Cloud is not connected, run `agentlink list-connected-integrations` to check, then connect it via the Shield UI.
