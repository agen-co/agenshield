---
name: agenco-github
description: "GitHub actions available through AgenCo"
user-invocable: false
disable-model-invocation: false
---

# GitHub

Actions available through AgenCo secure gateway. All credentials are stored in the cloud vault — never exposed locally.

## Actions

| Action | Description |
|--------|-------------|
| list_repositories | Retrieves repositories the user has access to |
| get_repository | Fetches repository details including branches and settings |
| create_repository | Creates new repositories with initial settings |
| list_issues | Gets open and closed issues from a repository |
| create_issue | Opens new issues with labels, assignees, and milestones |
| update_issue | Modifies issue status, labels, or assignees |
| list_pull_requests | Retrieves pull requests with review status |
| create_pull_request | Opens new pull requests for code review |
| merge_pull_request | Merges approved pull requests into target branch |
| list_commits | Gets commit history for branches or files |
| create_release | Creates new releases with tags and release notes |

## How to Use

**Always search first** to discover exact tool names and their input schemas, then call the tool.

### Step 1: Search for the tool

```bash
agenco search-tools '{"queries":["github list repositories"]}'
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
agenco search-tools '{"queries":["github list repositories"]}'

# Call it (use the exact toolName and schema from the search result)
agenco call-tool '{"toolName":"github_list_repositories","input":{...}}'
```

> If GitHub is not connected, run `agenco list-connected-integrations` to check, then connect it via the Shield UI.
