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
const vnetName = networkingStack.requireOutput("vnetName") as pulumi.Output<string>;
const networkingRgName = networkingStack.requireOutput("networkingResourceGroupName") as pulumi.Output<string>;

// From app-secrets
const keyVaultUri = secretsStack.requireOutput("keyVaultUri") as pulumi.Output<string>;
const keyVaultId = secretsStack.requireOutput("keyVaultId") as pulumi.Output<string>;

// uniqueSuffix scopes globally-unique Azure resource names to this deployment.
const uniqueSuffix = config.require("uniqueSuffix");

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
    workspaceName: pulumi.interpolate`log-api-${vnetName.apply(n => n.replace("vnet-", ""))}-${uniqueSuffix}`,
    sku: { name: "PerGB2018" },
    retentionInDays: 30,
    tags: { managedBy: "pulumi", stack: "api-service" },
});

const logWorkspaceKeys = azure.operationalinsights.getSharedKeysOutput({
    resourceGroupName: apiRg.name,
    workspaceName: logWorkspace.name,
});

// Container Apps Environment — VNet-integrated, running in the db subnet so
const containerEnv = new azure.app.ManagedEnvironment("container-env", {
    resourceGroupName: apiRg.name,
    location,
    environmentName: pulumi.interpolate`cae-api-${vnetName.apply(n => n.replace("vnet-", ""))}-${uniqueSuffix}`,
    appLogsConfiguration: {
        destination: "log-analytics",
        logAnalyticsConfiguration: {
            customerId: logWorkspace.customerId,
            sharedKey: logWorkspaceKeys.apply(k => k.primarySharedKey!),
        },
    },
    tags: { managedBy: "pulumi", stack: "api-service" },
});

// The API container app itself. Uses a managed identity to pull secrets from
// Key Vault — same pattern as the webapp.
const apiApp = new azure.app.ContainerApp("api-app", {
    resourceGroupName: apiRg.name,
    location,
    containerAppName: pulumi.interpolate`ca-api-${vnetName.apply(n => n.replace("vnet-", ""))}-${uniqueSuffix}`,
    managedEnvironmentId: containerEnv.id,
    identity: { type: "SystemAssigned" },
    configuration: {
        ingress: {
            external: false,
            targetPort: 3000,
            transport: "http",
        },
    },
    template: {
        containers: [
            {
                name: "api",
                image: "mcr.microsoft.com/k8se/quickstart:latest",
                resources: { cpu: 0.25, memory: "0.5Gi" },
                env: [
                    // The app uses its managed identity to fetch secrets from Key Vault
                    // at runtime — no secret values embedded at creation time.
                    { name: "KEY_VAULT_URI", value: keyVaultUri },
                    { name: "KEY_VAULT_DB_SECRET_NAME", value: pulumi.output("db-connection-string") },
                    { name: "KEY_VAULT_API_KEY_NAME", value: pulumi.output("third-party-api-key") },
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
