---
name: integration-circleci
description: "CircleCI actions available through AgenCo"
user-invocable: false
disable-model-invocation: false
---

# CircleCI

Actions available through AgenCo secure gateway. All credentials are stored in the cloud vault — never exposed locally.

## Actions

| Action | Description |
|--------|-------------|
| list_projects | Retrieves CircleCI projects |
| get_project | Fetches detailed project information |
| list_pipelines | Obtains CI/CD pipelines associated with projects |
| trigger_pipeline | Initiates new pipeline runs |
| list_jobs | Retrieves individual jobs from pipeline executions |

## How to Use

**Always search first** to discover exact tool names and their input schemas, then call the tool.

### Step 1: Search for the tool

```bash
agenco search-tools '{"queries":["circleci list projects"]}'
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
agenco search-tools '{"queries":["circleci list projects"]}'

# Call it (use the exact toolName and schema from the search result)
agenco call-tool '{"toolName":"circleci_list_projects","input":{...}}'
```

> If CircleCI is not connected, run `agenco list-connected-integrations` to check, then connect it via the Shield UI.
