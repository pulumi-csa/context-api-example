import * as pulumi from "@pulumi/pulumi";
import * as azure from "@pulumi/azure-native";

const config = new pulumi.Config();
const env = config.require("environment");
const location = config.get("location") ?? "eastus";
const lastModified = new Date().toISOString();
const modifiedBy = process.env.USER ?? process.env.USERNAME ?? "pulumi";

const commonTags = {
    environment: env,
    managedBy: "pulumi",
    stack: "resource-groups",
    "last-modified": lastModified,
    "modified-by": modifiedBy,
    "change-reason": "add-required-change-tracking-and-cost-management-tags",
    "cost-center": "engineering",
    project: "context-api-demo",
    owner: "platform",
    team: "platform",
};

// Separate resource groups follow the common Azure pattern of isolating
// network, shared-services, and workload resources for RBAC + lifecycle reasons.
const networkingRg = new azure.resources.ResourceGroup("networking-rg", {
    resourceGroupName: `rg-networking-${env}`,
    location,
    tags: commonTags,
});

const sharedRg = new azure.resources.ResourceGroup("shared-rg", {
    resourceGroupName: `rg-shared-${env}`,
    location,
    tags: commonTags,
});

const appRg = new azure.resources.ResourceGroup("app-rg", {
    resourceGroupName: `rg-app-${env}`,
    location,
    tags: commonTags,
});

export const networkingResourceGroupName = networkingRg.name;
export const sharedResourceGroupName = sharedRg.name;
export const appResourceGroupName = appRg.name;
export const location_ = pulumi.output(location);
export const environment = pulumi.output(env);
