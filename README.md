# Context API demo — Azure multi-stack example

Five Pulumi stacks with intentional cross-stack dependencies to demonstrate the context API's blast-radius and dependency-tracing queries.

```
01-resource-groups              (no dependencies)
    ├── 02-core-networking      (depends on 01)
    ├── 03-app-secrets          (depends on 01)
    ├── 04-webapp               (depends on 02 + 03) — Azure App Service
    └── 05-api-service          (depends on 02 + 03) — Azure Container App
```

## Setup

Replace `elisabeth-demo` with your Pulumi org name in each `Pulumi.dev.yaml`, then:

```bash
cd 03-app-secrets && pulumi config set tenantId <your-azure-tenant-id> -s dev

for dir in 01-resource-groups 02-core-networking 03-app-secrets 04-webapp 05-api-service; do
  (cd $dir && npm install)
done
```

## Deploy in order

```bash
cd 01-resource-groups  && pulumi up -s dev -y
cd ../02-core-networking && pulumi up -s dev -y
cd ../03-app-secrets    && pulumi up -s dev -y
cd ../04-webapp         && pulumi up -s dev -y
cd ../05-api-service    && pulumi up -s dev -y
```

## Context API demo

### Blast radius: what does changing `core-networking` break?

```bash
pulumi api GraphQuery -F orgName=elisabeth-demo --input demo/selectors/02-blast-radius-networking.json
```

Or via Postman / curl:

```
POST https://api.pulumi.com/api/insights/elisabeth-demo/graph/query
Authorization: token <PULUMI_ACCESS_TOKEN>
Content-Type: application/json
```

```json
{
  "scope": { "stacks": ["context-api-core-networking/dev"] },
  "anchor": { "nodeType": "stack" },
  "traverse": [
    {
      "edgeTypes": ["consumes_outputs_of"],
      "direction": "in",
      "depth": { "min": 1, "max": 5 },
      "alias": "consumers"
    }
  ],
  "return": {
    "select": ["anchor", "consumers"],
    "paths": true
  }
}
```

Expected: both `context-api-webapp/dev` and `context-api-api-service/dev` appear as consumers.


## Stack outputs reference

| Stack | Key outputs |
|---|---|
| `01-resource-groups` | `networkingResourceGroupName`, `sharedResourceGroupName`, `appResourceGroupName` |
| `02-core-networking` | `vnetId`, `vnetName`, `appSubnetId`, `dbSubnetId` |
| `03-app-secrets` | `keyVaultUri`, `keyVaultId`, `dbSecretUri`, `apiKeySecretUri` |
| `04-webapp` | `appUrl`, `appName` |
| `05-api-service` | `apiAppFqdn`, `apiAppName` |
