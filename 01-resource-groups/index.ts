import * as pulumi from "@pulumi/pulumi";
import * as azure from "@pulumi/azure-native";

const config = new pulumi.Config();
const env = config.require("environment");
const location = config.get("location") ?? "eastus";

// Separate resource groups follow the common Azure pattern of isolating
// network, shared-services, and workload resources for RBAC + lifecycle reasons.
const networkingRg = new azure.resources.ResourceGroup("networking-rg", {
    resourceGroupName: `rg-networking-${env}`,
    location,
    tags: { environment: env, managedBy: "pulumi", stack: "resource-groups" },
});

const sharedRg = new azure.resources.ResourceGroup("shared-rg", {
    resourceGroupName: `rg-shared-${env}`,
    location,
    tags: { environment: env, managedBy: "pulumi", stack: "resource-groups" },
});

const appRg = new azure.resources.ResourceGroup("app-rg", {
    resourceGroupName: `rg-app-${env}`,
    location,
    tags: { environment: env, managedBy: "pulumi", stack: "resource-groups" },
});

export const networkingResourceGroupName = networkingRg.name;
export const sharedResourceGroupName = sharedRg.name;
export const appResourceGroupName = appRg.name;
export const location_ = pulumi.output(location);
export const environment = pulumi.output(env);
