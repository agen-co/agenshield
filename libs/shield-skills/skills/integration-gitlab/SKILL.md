---
name: integration-gitlab
description: "GitLab actions available through AgentLink"
user-invocable: false
disable-model-invocation: false
---

# GitLab

Actions available through AgentLink secure gateway. All credentials are stored in the cloud vault — never exposed locally.

## Actions

| Action | Description |
|--------|-------------|
| list_projects | Retrieves accessible projects with read permission |
| list_issues | Gets project issues for tracking and management |
| list_merge_requests | Retrieves merge requests for code review workflows |

## How to Use

**Always search first** to discover exact tool names and their input schemas, then call the tool.

### Step 1: Search for the tool

```bash
agentlink search-tools '{"queries":["gitlab list projects"]}'
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
agentlink search-tools '{"queries":["gitlab list projects"]}'

# Call it (use the exact toolName and schema from the search result)
agentlink call-tool '{"toolName":"gitlab_list_projects","input":{...}}'
```

> If GitLab is not connected, run `agentlink list-connected-integrations` to check, then connect it via the Shield UI.
