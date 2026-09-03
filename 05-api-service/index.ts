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

const uniqueSuffix = config.require("uniqueSuffix");

// From core-networking
const appSubnetId = networkingStack.requireOutput("appSubnetId") as pulumi.Output<string>;
const vnetName = networkingStack.requireOutput("vnetName") as pulumi.Output<string>;
const networkingRgName = networkingStack.requireOutput("networkingResourceGroupName") as pulumi.Output<string>;

// From app-secrets
const keyVaultUri = secretsStack.requireOutput("keyVaultUri") as pulumi.Output<string>;
const keyVaultId = secretsStack.requireOutput("keyVaultId") as pulumi.Output<string>;

const networkingRg = azure.resources.getResourceGroupOutput({
    resourceGroupName: networkingRgName,
});
const location = networkingRg.location;
const env = vnetName.apply(n => n.replace("vnet-", ""));

// Dedicated resource group for the API service tier.
const apiRg = new azure.resources.ResourceGroup("api-rg", {
    resourceGroupName: pulumi.interpolate`rg-api-${env}`,
    location,
    tags: { managedBy: "pulumi", stack: "api-service" },
});

const appServicePlan = new azure.web.AppServicePlan("api-plan", {
    resourceGroupName: apiRg.name,
    location,
    name: pulumi.interpolate`asp-api-${env}-${uniqueSuffix}`,
    kind: "Linux",
    reserved: true,
    sku: { name: "P1v3", tier: "PremiumV3" },
    tags: { managedBy: "pulumi", stack: "api-service" },
});

const apiApp = new azure.web.WebApp("api-app", {
    resourceGroupName: apiRg.name,
    location,
    name: pulumi.interpolate`api-${env}-${uniqueSuffix}`,
    serverFarmId: appServicePlan.id,
    kind: "app,linux",
    identity: { type: "SystemAssigned" },
    siteConfig: {
        linuxFxVersion: "NODE|20-lts",
        alwaysOn: true,
        appSettings: [
            { name: "KEY_VAULT_URI", value: keyVaultUri },
        ],
    },
    httpsOnly: true,
    tags: { managedBy: "pulumi", stack: "api-service" },
});

// VNet integration — same app subnet as the webapp. Both apps sharing the
// delegated subnet is valid; the subnet is delegated to Microsoft.Web/serverFarms.
const vnetIntegration = new azure.web.WebAppSwiftVirtualNetworkConnection("vnet-integration", {
    resourceGroupName: apiRg.name,
    name: apiApp.name,
    subnetResourceId: appSubnetId,
});

const kvSecretsUserRole = "/providers/Microsoft.Authorization/roleDefinitions/4633458b-17de-408a-b874-0445c86b69e6";

const keyVaultRoleAssignment = new azure.authorization.RoleAssignment("kv-role-assignment", {
    scope: keyVaultId,
    roleDefinitionId: kvSecretsUserRole,
    principalId: apiApp.identity.apply(i => i!.principalId),
    principalType: "ServicePrincipal",
});

export const apiUrl = pulumi.interpolate`https://${apiApp.defaultHostName}`;
export const apiAppName = apiApp.name;
export const apiPrincipalId = apiApp.identity.apply(i => i!.principalId);
export const apiResourceGroupName = apiRg.name;
