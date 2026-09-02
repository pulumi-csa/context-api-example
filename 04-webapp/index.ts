import * as pulumi from "@pulumi/pulumi";
import * as azure from "@pulumi/azure-native";

const config = new pulumi.Config();

// Three hard stack dependencies — this stack breaks if any upstream changes
// an output it exports. The context API's blast-radius query surfaces exactly
// this chain when you ask "what depends on core-networking?".
const rgStack = new pulumi.StackReference("rg-stack", {
    name: config.require("rgStackRef"),
});
const networkingStack = new pulumi.StackReference("networking-stack", {
    name: config.require("networkingStackRef"),
});
const secretsStack = new pulumi.StackReference("secrets-stack", {
    name: config.require("secretsStackRef"),
});

// uniqueSuffix scopes globally-unique Azure resource names to this deployment.
const uniqueSuffix = config.require("uniqueSuffix");

// From resource-groups — use the RG that stack owns rather than creating a duplicate.
const appRgName = rgStack.requireOutput("appResourceGroupName") as pulumi.Output<string>;

// From core-networking
const appSubnetId = networkingStack.requireOutput("appSubnetId") as pulumi.Output<string>;
const vnetName = networkingStack.requireOutput("vnetName") as pulumi.Output<string>;
const networkingRgName = networkingStack.requireOutput("networkingResourceGroupName") as pulumi.Output<string>;

// From app-secrets
const keyVaultUri = secretsStack.requireOutput("keyVaultUri") as pulumi.Output<string>;
const keyVaultId = secretsStack.requireOutput("keyVaultId") as pulumi.Output<string>;
const dbSecretUri = secretsStack.requireOutput("dbSecretUri") as pulumi.Output<string>;
const apiKeySecretUri = secretsStack.requireOutput("apiKeySecretUri") as pulumi.Output<string>;

const networkingRg = azure.resources.getResourceGroupOutput({
    resourceGroupName: networkingRgName,
});
const location = networkingRg.location;

// App Service Plan — P1v3 is the minimum tier that supports VNet integration.
const appServicePlan = new azure.web.AppServicePlan("app-service-plan", {
    resourceGroupName: appRgName,
    location,
    name: pulumi.interpolate`asp-${vnetName.apply(n => n.replace("vnet-", ""))}-${uniqueSuffix}`,
    kind: "Linux",
    reserved: true,
    sku: { name: "P1v3", tier: "PremiumV3" },
    tags: { managedBy: "pulumi", stack: "webapp" },
});

// The web app gets a system-assigned managed identity so it can pull secrets
// from Key Vault without any credentials in config.
const webApp = new azure.web.WebApp("web-app", {
    resourceGroupName: appRgName,
    location,
    name: pulumi.interpolate`app-${vnetName.apply(n => n.replace("vnet-", ""))}-${uniqueSuffix}`,
    serverFarmId: appServicePlan.id,
    kind: "app,linux",
    identity: { type: "SystemAssigned" },
    siteConfig: {
        linuxFxVersion: "NODE|20-lts",
        alwaysOn: true,
        // Key Vault references (@Microsoft.KeyVault(...)) let App Service resolve
        // secrets at runtime through the managed identity — no plaintext values.
        appSettings: [
            {
                name: "DB_CONNECTION_STRING",
                value: pulumi.interpolate`@Microsoft.KeyVault(SecretUri=${dbSecretUri})`,
            },
            {
                name: "THIRD_PARTY_API_KEY",
                value: pulumi.interpolate`@Microsoft.KeyVault(SecretUri=${apiKeySecretUri})`,
            },
            {
                name: "KEY_VAULT_URI",
                value: keyVaultUri,
            },
        ],
        cors: {
            allowedOrigins: ["https://portal.azure.com"],
        },
    },
    httpsOnly: true,
    tags: { managedBy: "pulumi", stack: "webapp" },
});

// VNet integration puts the app's outbound traffic on the app subnet.
// This is the direct dependency on core-networking — if the subnet is replaced,
// this resource must be updated too, and the context API will show it.
const vnetIntegration = new azure.web.WebAppSwiftVirtualNetworkConnection("vnet-integration", {
    resourceGroupName: appRgName,
    name: webApp.name,
    subnetResourceId: appSubnetId,
});

// Grant the web app's managed identity the Key Vault Secrets User role so it
// can read secrets via Key Vault references above.
const kvSecretsUserRole = "/providers/Microsoft.Authorization/roleDefinitions/4633458b-17de-408a-b874-0445c86b69e6";

const keyVaultRoleAssignment = new azure.authorization.RoleAssignment("kv-role-assignment", {
    scope: keyVaultId,
    roleDefinitionId: kvSecretsUserRole,
    principalId: webApp.identity.apply(i => i!.principalId),
    principalType: "ServicePrincipal",
});

export const appUrl = pulumi.interpolate`https://${webApp.defaultHostName}`;
export const appName = webApp.name;
export const appPrincipalId = webApp.identity.apply(i => i!.principalId);
export const appResourceGroupName = appRgName;
export const vnetIntegrationSubnetId = appSubnetId;
