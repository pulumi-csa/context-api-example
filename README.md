# Context API demo — Azure multi-stack example

Five Pulumi stacks with intentional cross-stack dependencies, designed to demonstrate the [context API](https://app.notion.com/p/3bcfdbdf1cce815abd39d97463f781d9) blast-radius and dependency-tracing queries.

```
01-resource-groups              (no dependencies)
    ├── 02-core-networking      (depends on 01)
    ├── 03-app-secrets          (depends on 01)
    ├── 04-webapp               (depends on 02 + 03) — Azure App Service
    └── 05-api-service          (depends on 02 + 03) — Azure Container App
```

**The key blast-radius story:** both `04-webapp` and `05-api-service` hold stack references into `02-core-networking`. Change the VNet address space in `02-core-networking`, and the context API immediately tells you both downstream apps are in the blast radius — before you touch a single resource.

## Prerequisites

- Pulumi CLI ≥ 3.243.0
- Azure subscription + `az login` (or service principal env vars)
- Node.js 18+

## One-time setup

In each stack config, replace `organization` with your Pulumi org name:

```bash
# 02-core-networking/Pulumi.dev.yaml
context-api-core-networking:rgStackRef: <your-org>/context-api-resource-groups/dev

# 03-app-secrets/Pulumi.dev.yaml
context-api-app-secrets:rgStackRef: <your-org>/context-api-resource-groups/dev

# 04-webapp/Pulumi.dev.yaml
context-api-webapp:networkingStackRef: <your-org>/context-api-core-networking/dev
context-api-webapp:secretsStackRef:    <your-org>/context-api-app-secrets/dev

# 05-api-service/Pulumi.dev.yaml
context-api-api-service:networkingStackRef: <your-org>/context-api-core-networking/dev
context-api-api-service:secretsStackRef:    <your-org>/context-api-app-secrets/dev
```

Set your Azure tenant ID (needed by Key Vault):

```bash
cd 03-app-secrets
pulumi config set tenantId <your-azure-tenant-id> -s dev
```

Install dependencies:

```bash
for dir in 01-resource-groups 02-core-networking 03-app-secrets 04-webapp 05-api-service; do
  (cd $dir && npm install)
done
```

## Deploy in order

Stack references require each upstream stack to exist before the downstream one runs.

```bash
cd 01-resource-groups  && pulumi up -s dev -y
cd ../02-core-networking && pulumi up -s dev -y
cd ../03-app-secrets    && pulumi up -s dev -y
cd ../04-webapp         && pulumi up -s dev -y
cd ../05-api-service    && pulumi up -s dev -y
```

## Context API demo

### 1. Get the schema primer

```bash
pulumi api GetGraphSchema
```

Paste the output into your agent session, or just ask — Neo already knows the API.

### Demo question: what is the blast radius of `core-networking`?

Ask your agent (or Neo):

> "What breaks if I change the outputs of the `context-api-core-networking/dev` stack?"

The graph query the agent should compose:

```json
{
  "anchor": { "nodeType": "stack", "query": "name:context-api-core-networking" },
  "traverse": [{ "edgeType": "stackReference", "direction": "in", "hops": { "min": 1 } }],
  "return": { "select": ["traversed"] }
}
```

Expected result: **both** `context-api-webapp/dev` and `context-api-api-service/dev` appear as downstream consumers.

### Demo question: full blast radius from `resource-groups`

> "Which stacks depend on `context-api-resource-groups/dev`, directly or transitively?"

All four downstream stacks should appear. `02-core-networking` and `03-app-secrets` are direct; `04-webapp` and `05-api-service` are transitive (two hops).

### Demo question: what does the webapp consume?

> "What does `context-api-webapp/dev` depend on?"

Traverses `stackReference` edges outward: returns `02-core-networking/dev` and `03-app-secrets/dev` (and transitively `01-resource-groups/dev`).

### Demo question: provider inventory

> "Which azure-native provider versions are running across this project, and in which stacks?"

### Making the change (live blast-radius proof)

```bash
cd 02-core-networking
pulumi config set vnetAddressSpace 10.1.0.0/16 -s dev
pulumi preview -s dev
```

The preview shows VNet + subnets as forced replacements. The context API already told you `04-webapp` and `05-api-service` are in the blast radius — the preview confirms it.

## Stack outputs reference

| Stack | Key outputs |
|---|---|
| `01-resource-groups` | `networkingResourceGroupName`, `sharedResourceGroupName`, `appResourceGroupName` |
| `02-core-networking` | `vnetId`, `vnetName`, `vnetAddressSpaceOutput`, `appSubnetId`, `dbSubnetId` |
| `03-app-secrets` | `keyVaultUri`, `keyVaultId`, `dbSecretUri`, `apiKeySecretUri` |
| `04-webapp` | `appUrl`, `appName`, `appPrincipalId` |
| `05-api-service` | `apiAppFqdn`, `apiAppName`, `apiPrincipalId` |
