import * as pulumi from "@pulumi/pulumi";
import * as azure from "@pulumi/azure-native";

const config = new pulumi.Config();
const vnetAddressSpace = config.get("vnetAddressSpace") ?? "10.0.0.0/16";
const appSubnetPrefix = config.get("appSubnetPrefix") ?? "10.0.1.0/24";
const dbSubnetPrefix = config.get("dbSubnetPrefix") ?? "10.0.2.0/24";

// Pull location and resource group from the resource-groups stack.
// This is a hard stack dependency — changes to those outputs flow here first.
const rgStackRef = new pulumi.StackReference("rg-stack", {
    name: config.require("rgStackRef"),
});

const networkingRgName = rgStackRef.requireOutput("networkingResourceGroupName") as pulumi.Output<string>;
const location = rgStackRef.requireOutput("location_") as pulumi.Output<string>;
const env = rgStackRef.requireOutput("environment") as pulumi.Output<string>;

// NSG for the app tier — allows inbound HTTPS from the internet, outbound anywhere.
const appNsg = new azure.network.NetworkSecurityGroup("app-nsg", {
    resourceGroupName: networkingRgName,
    location,
    networkSecurityGroupName: pulumi.interpolate`nsg-app-${env}`,
    securityRules: [
        {
            name: "allow-https-inbound",
            priority: 100,
            direction: "Inbound",
            access: "Allow",
            protocol: "Tcp",
            sourcePortRange: "*",
            destinationPortRange: "443",
            sourceAddressPrefix: "Internet",
            destinationAddressPrefix: "VirtualNetwork",
        },
        {
            name: "allow-http-inbound",
            priority: 110,
            direction: "Inbound",
            access: "Allow",
            protocol: "Tcp",
            sourcePortRange: "*",
            destinationPortRange: "80",
            sourceAddressPrefix: "Internet",
            destinationAddressPrefix: "VirtualNetwork",
        },
    ],
    tags: { managedBy: "pulumi", stack: "core-networking" },
});

// NSG for the data tier — only allows traffic from the app subnet.
const dbNsg = new azure.network.NetworkSecurityGroup("db-nsg", {
    resourceGroupName: networkingRgName,
    location,
    networkSecurityGroupName: pulumi.interpolate`nsg-db-${env}`,
    securityRules: [
        {
            name: "allow-app-subnet-inbound",
            priority: 100,
            direction: "Inbound",
            access: "Allow",
            protocol: "Tcp",
            sourcePortRange: "*",
            destinationPortRange: "5432",
            sourceAddressPrefix: appSubnetPrefix,
            destinationAddressPrefix: "*",
        },
        {
            name: "deny-internet-inbound",
            priority: 4000,
            direction: "Inbound",
            access: "Deny",
            protocol: "*",
            sourcePortRange: "*",
            destinationPortRange: "*",
            sourceAddressPrefix: "Internet",
            destinationAddressPrefix: "*",
        },
    ],
    tags: { managedBy: "pulumi", stack: "core-networking" },
});

// The core VNet. Changing vnetAddressSpace here forces replacement of this
// resource and propagates to every stack that consumes vnetId or subnet IDs —
// that blast radius is exactly what the context API demonstrates.
const vnet = new azure.network.VirtualNetwork("vnet", {
    resourceGroupName: networkingRgName,
    location,
    virtualNetworkName: pulumi.interpolate`vnet-${env}`,
    addressSpace: { addressPrefixes: [vnetAddressSpace] },
    tags: { managedBy: "pulumi", stack: "core-networking" },
});

// App subnet — App Service VNet integration delegates this subnet to the service.
const appSubnet = new azure.network.Subnet("app-subnet", {
    resourceGroupName: networkingRgName,
    virtualNetworkName: vnet.name,
    subnetName: "snet-app",
    addressPrefix: appSubnetPrefix,
    delegations: [
        {
            name: "app-service-delegation",
            serviceName: "Microsoft.Web/serverFarms",
        },
    ],
    networkSecurityGroup: { id: appNsg.id },
});

// DB subnet — private endpoints for data services live here.
const dbSubnet = new azure.network.Subnet("db-subnet", {
    resourceGroupName: networkingRgName,
    virtualNetworkName: vnet.name,
    subnetName: "snet-db",
    addressPrefix: dbSubnetPrefix,
    networkSecurityGroup: { id: dbNsg.id },
    privateEndpointNetworkPolicies: "Disabled",
});

export const vnetId = vnet.id;
export const vnetName = vnet.name;
export const vnetAddressSpaceOutput = pulumi.output(vnetAddressSpace);
export const appSubnetId = appSubnet.id;
export const appSubnetName = appSubnet.name;
export const dbSubnetId = dbSubnet.id;
export const appNsgId = appNsg.id;
export const dbNsgId = dbNsg.id;
export const networkingResourceGroupName = networkingRgName;
