import * as pulumi from "@pulumi/pulumi";
import * as azure from "@pulumi/azure-native";

const config = new pulumi.Config();

// Pull the shared resource group and location from the resource-groups stack.
const rgStackRef = new pulumi.StackReference("rg-stack", {
    name: config.require("rgStackRef"),
});

const sharedRgName = rgStackRef.requireOutput("sharedResourceGroupName") as pulumi.Output<string>;
const location = rgStackRef.requireOutput("location_") as pulumi.Output<string>;
const env = rgStackRef.requireOutput("environment") as pulumi.Output<string>;

// Key Vault name must be globally unique and ≤24 chars.
// uniqueSuffix should be a short string (e.g. initials) set via config.
const uniqueSuffix = config.require("uniqueSuffix");
const keyVaultName = pulumi.interpolate`kv-${env}-${uniqueSuffix}`;

const keyVault = new azure.keyvault.Vault("key-vault", {
    resourceGroupName: sharedRgName,
    location,
    vaultName: keyVaultName,
    properties: {
        sku: { family: "A", name: "standard" },
        tenantId: config.require("tenantId"),
        // Soft-delete is required; purge protection keeps secrets recoverable for 7 days.
        enableSoftDelete: true,
        softDeleteRetentionInDays: 7,
        enableRbacAuthorization: true,
        // The webapp's managed identity is granted access in the webapp stack via RBAC.
    },
    tags: { managedBy: "pulumi", stack: "app-secrets" },
});

// Placeholder DB connection string — in a real environment this would be
// composed from a database stack's outputs (host, port, db name) plus a
// generated password stored as a Pulumi secret.
const dbConnectionString = new azure.keyvault.Secret("db-connection-string", {
    resourceGroupName: sharedRgName,
    vaultName: keyVault.name,
    secretName: "db-connection-string",
    properties: {
        value: pulumi.secret("Server=db.internal;Database=appdb;User Id=appuser;Password=REPLACE_ME"),
        contentType: "text/plain",
    },
    tags: { managedBy: "pulumi", stack: "app-secrets" },
});

// API key for an upstream service.
const thirdPartyApiKey = new azure.keyvault.Secret("third-party-api-key", {
    resourceGroupName: sharedRgName,
    vaultName: keyVault.name,
    secretName: "third-party-api-key",
    properties: {
        value: pulumi.secret("REPLACE_ME_WITH_REAL_KEY"),
        contentType: "text/plain",
    },
    tags: { managedBy: "pulumi", stack: "app-secrets" },
});

export const keyVaultId = keyVault.id;
export const keyVaultUri = keyVault.properties.apply(p => p.vaultUri!);
export const keyVaultName_ = keyVault.name;
export const dbSecretUri = pulumi.interpolate`${keyVault.properties.apply(p => p.vaultUri!)}secrets/${dbConnectionString.name}`;
export const apiKeySecretUri = pulumi.interpolate`${keyVault.properties.apply(p => p.vaultUri!)}secrets/${thirdPartyApiKey.name}`;
export const sharedResourceGroupName = sharedRgName;
