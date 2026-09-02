import * as pulumi from "@pulumi/pulumi";
import * as azure from "@pulumi/azure-native";

const config = new pulumi.Config();

// Same two upstream stacks as the webapp — this is what makes the blast-radius
// query interesting: changing core-networking surfaces *both* this stack and
// the webapp stack as downstream consumers.
const networkingStack = new pulumi.StackReference("networking-stack", {
    name: config.require("networkingStackRef"),
});
const secretsStack = new pulumi.StackReference("secrets-stack", {
    name: config.require("secretsStackRef"),
});

// From core-networking
const dbSubnetId = networkingStack.requireOutput("dbSubnetId") as pulumi.Output<string>;
const vnetId = networkingStack.requireOutput("vnetId") as pulumi.Output<string>;
const vnetName = networkingStack.requireOutput("vnetName") as pulumi.Output<string>;
const networkingRgName = networkingStack.requireOutput("networkingResourceGroupName") as pulumi.Output<string>;

// From app-secrets
const keyVaultUri = secretsStack.requireOutput("keyVaultUri") as pulumi.Output<string>;
const keyVaultId = secretsStack.requireOutput("keyVaultId") as pulumi.Output<string>;
const dbSecretUri = secretsStack.requireOutput("dbSecretUri") as pulumi.Output<string>;
const apiKeySecretUri = secretsStack.requireOutput("apiKeySecretUri") as pulumi.Output<string>;

// Derive location from the networking resource group.
const networkingRg = azure.resources.getResourceGroupOutput({
    resourceGroupName: networkingRgName,
});
const location = networkingRg.location;

// The API service gets its own resource group.
const apiRg = new azure.resources.ResourceGroup("api-rg", {
    resourceGroupName: pulumi.interpolate`rg-api-${vnetName.apply(n => n.replace("vnet-", ""))}`,
    location,
    tags: { managedBy: "pulumi", stack: "api-service" },
});

// Log Analytics workspace — required by Container Apps Environment.
const logWorkspace = new azure.operationalinsights.Workspace("log-workspace", {
    resourceGroupName: apiRg.name,
    location,
    workspaceName: pulumi.interpolate`log-api-${vnetName.apply(n => n.replace("vnet-", ""))}`,
    sku: { name: "PerGB2018" },
    retentionInDays: 30,
    tags: { managedBy: "pulumi", stack: "api-service" },
});

const logWorkspaceKeys = azure.operationalinsights.getSharedKeysOutput({
    resourceGroupName: apiRg.name,
    workspaceName: logWorkspace.name,
});

// Container Apps Environment — VNet-integrated, running in the db subnet so
// the API service can reach data services without traversing the internet.
// This dependency on dbSubnetId is what the context API traces when you ask
// "what is affected if core-networking changes?".
const containerEnv = new azure.app.ManagedEnvironment("container-env", {
    resourceGroupName: apiRg.name,
    location,
    environmentName: pulumi.interpolate`cae-api-${vnetName.apply(n => n.replace("vnet-", ""))}`,
    appLogsConfiguration: {
        destination: "log-analytics",
        logAnalyticsConfiguration: {
            customerId: logWorkspace.customerId,
            sharedKey: logWorkspaceKeys.apply(k => k.primarySharedKey!),
        },
    },
    vnetConfiguration: {
        infrastructureSubnetId: dbSubnetId,
        internal: true,
    },
    tags: { managedBy: "pulumi", stack: "api-service" },
});

// The API container app itself. Uses a managed identity to pull secrets from
// Key Vault — same pattern as the webapp.
const apiApp = new azure.app.ContainerApp("api-app", {
    resourceGroupName: apiRg.name,
    location,
    containerAppName: pulumi.interpolate`ca-api-${vnetName.apply(n => n.replace("vnet-", ""))}`,
    managedEnvironmentId: containerEnv.id,
    identity: { type: "SystemAssigned" },
    configuration: {
        ingress: {
            external: false,
            targetPort: 3000,
            transport: "http",
        },
        secrets: [
            {
                name: "db-connection-string",
                keyVaultUrl: dbSecretUri,
                // identity references the system-assigned identity below —
                // set after first deploy when principalId is available
                identity: "system",
            },
            {
                name: "third-party-api-key",
                keyVaultUrl: apiKeySecretUri,
                identity: "system",
            },
        ],
    },
    template: {
        containers: [
            {
                name: "api",
                image: "mcr.microsoft.com/k8se/quickstart:latest",
                resources: { cpu: 0.25, memory: "0.5Gi" },
                env: [
                    { name: "DB_CONNECTION_STRING", secretRef: "db-connection-string" },
                    { name: "THIRD_PARTY_API_KEY", secretRef: "third-party-api-key" },
                    { name: "KEY_VAULT_URI", value: keyVaultUri },
                    { name: "PORT", value: "3000" },
                ],
            },
        ],
        scale: { minReplicas: 1, maxReplicas: 5 },
    },
    tags: { managedBy: "pulumi", stack: "api-service" },
});

const kvSecretsUserRole = "/providers/Microsoft.Authorization/roleDefinitions/4633458b-17de-408a-b874-0445c86b69e6";

const keyVaultRoleAssignment = new azure.authorization.RoleAssignment("kv-role-assignment", {
    scope: keyVaultId,
    roleDefinitionId: kvSecretsUserRole,
    principalId: apiApp.identity.apply(i => i!.principalId),
    principalType: "ServicePrincipal",
});

export const apiAppName = apiApp.name;
export const apiAppFqdn = apiApp.latestRevisionFqdn;
export const apiPrincipalId = apiApp.identity.apply(i => i!.principalId);
export const apiResourceGroupName = apiRg.name;
export const containerEnvId = containerEnv.id;
export const vnetIntegrationSubnetId = dbSubnetId;
