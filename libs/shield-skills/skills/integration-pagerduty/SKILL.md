---
name: integration-pagerduty
description: "PagerDuty actions available through AgenCo"
user-invocable: false
disable-model-invocation: false
---

# PagerDuty

Actions available through AgenCo secure gateway. All credentials are stored in the cloud vault — never exposed locally.

## Actions

| Action | Description |
|--------|-------------|
| list_incidents | Retrieves active and recent incidents |
| get_incident | Fetches incident details and timeline |
| create_incident | Manually triggers new incidents |
| update_incident | Modifies incident status or assignment |
| resolve_incident | Marks incidents as resolved |
| acknowledge_incident | Acknowledges incidents to stop escalation |
| list_services | Gets monitored services |
| list_schedules | Retrieves on-call schedules |
| list_oncalls | Gets current on-call responders |

## How to Use

**Always search first** to discover exact tool names and their input schemas, then call the tool.

### Step 1: Search for the tool

```bash
agenco search-tools '{"queries":["pagerduty list incidents"]}'
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
agenco search-tools '{"queries":["pagerduty list incidents"]}'

# Call it (use the exact toolName and schema from the search result)
agenco call-tool '{"toolName":"pagerduty_list_incidents","input":{...}}'
```

> If PagerDuty is not connected, run `agenco list-connected-integrations` to check, then connect it via the Shield UI.
