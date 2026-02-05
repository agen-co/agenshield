---
name: integration-digitalocean
description: "DigitalOcean actions available through AgenCo"
user-invocable: false
disable-model-invocation: false
---

# DigitalOcean

Actions available through AgenCo secure gateway. All credentials are stored in the cloud vault — never exposed locally.

## Actions

| Action | Description |
|--------|-------------|
| get_account | Retrieves account information |
| list_droplets | Gets virtual machines |
| create_droplet | Creates new droplets |
| delete_droplet | Removes droplets |
| list_volumes | Gets block storage volumes |
| list_domains | Retrieves managed domains |
| list_databases | Gets managed databases |
| list_ssh_keys | Retrieves SSH keys |

## How to Use

**Always search first** to discover exact tool names and their input schemas, then call the tool.

### Step 1: Search for the tool

```bash
agenco search-tools '{"queries":["digitalocean get account"]}'
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
agenco search-tools '{"queries":["digitalocean get account"]}'

# Call it (use the exact toolName and schema from the search result)
agenco call-tool '{"toolName":"digitalocean_get_account","input":{...}}'
```

> If DigitalOcean is not connected, run `agenco list-connected-integrations` to check, then connect it via the Shield UI.
