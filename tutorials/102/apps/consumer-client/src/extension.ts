// Copyright 2025 IOTA Stiftung.
// SPDX-License-Identifier: Apache-2.0.
import type { IHttpRequestContext, IRestRoute } from "@twin.org/api-models";
import { ComponentFactory } from "@twin.org/core";
import type {
	EngineTypeInitialiserReturn,
	IEngineCore,
	IEngineCoreConfig,
	IEngineCoreContext,
	IEngineServer
} from "@twin.org/engine-models";
import {
	type IEngineConfig,
	DataspaceControlPlaneComponentType,
	DataspaceDataPlaneComponentType,
	EngineTypeHelper,
	FederatedCatalogueComponentType
} from "@twin.org/engine-types";
import { ConsumerClient } from "./consumerClient.js";
import type { IConsumerClientComponent } from "./IConsumerClientComponent.js";
import type { IConsumerClientConstructorOptions } from "./IConsumerClientConstructorOptions.js";
import type { IConsumerRequest } from "./IConsumerRequest.js";

/**
 * Initialise the  extension.
 * @param envVars The environment variables for the node.
 * @param nodeEngineConfig The node engine config.
 */
export async function extensionInitialise(
	envVars: { [id: string]: string | unknown },
	nodeEngineConfig: IEngineCoreConfig
): Promise<void> {
	nodeEngineConfig.types.consumerClientComponent = [
		{
			type: "service",
			options: {
				config: {}
			},
			restPath: "consumer-client"
		}
	];

	nodeEngineConfig.types.federatedCatalogueComponent = [
		{
			type: FederatedCatalogueComponentType.RestClient,
			options: {
				// The consumer reads the PROVIDER node's federated catalogue across the
				// docker network, so this is the provider container name.
				endpoint: "http://host.docker.internal:3000"
			},
			features: ["remote"]
		},
		{
			type: FederatedCatalogueComponentType.Service,
			restPath: "federated-catalogue",
			isDefault: true
		}
	];

	nodeEngineConfig.types.dataspaceControlPlaneComponent = [
		{
			type: DataspaceControlPlaneComponentType.Service,
			options: {
				// callbackPath MUST match restPath below so the callbackAddress this consumer advertises
				// (<publicOrigin>/<callbackPath>) points at its own control-plane mount; otherwise the
				// provider POSTs transfer callbacks (e.g. the auto-start TransferStartMessage) to the wrong
				// path and the consumer 404s.
				//
				// This config object REPLACES the env-built control-plane config, so dataPlanePath and
				// autoStartTransfers must be forwarded here too. Without dataPlanePath, pull transfers fail
				// with "pullTransfersNotSupported"; without autoStartTransfers=true the provider never
				// auto-starts the transfer, so the automated consumer-client (Way 1) hangs waiting for
				// onStarted. Set TWIN_DATASPACE_AUTO_START_TRANSFERS=false for the manual Postman/curl
				// walkthrough (Way 2) so the explicit ".../start" returns the data address synchronously.
				config: {
					callbackPath: "dataspace",
					// eslint-disable-next-line no-restricted-syntax -- tutorial extension reads node env directly
					dataPlanePath: process.env.TWIN_DATASPACE_DATA_PLANE_PATH ?? "dataspace",
					// eslint-disable-next-line no-restricted-syntax -- tutorial extension reads node env directly
					autoStartTransfers: process.env.TWIN_DATASPACE_AUTO_START_TRANSFERS !== "false"
				}
			},
			restPath: "dataspace",
			isDefault: true
		},
		{
			type: DataspaceControlPlaneComponentType.RestClient,
			options: {},
			features: ["remote"],
			isMultiInstance: true
		}
	];

	nodeEngineConfig.types.dataspaceDataPlaneComponent = [
		{
			type: DataspaceDataPlaneComponentType.Service,
			options: {
				config: {}
			},
			restPath: "dataspace",
			isDefault: true
		},
		{
			type: DataspaceDataPlaneComponentType.RestClient,
			features: ["remote"],
			isMultiInstance: true
		}
	];

	// When the consumer initiates a contract negotiation, the PNP
	// (sendRequestToProvider) builds a trust token whose credentialSubject is the
	// policy data returned by the Policy Information Point. With no PIP source the
	// PIP returns {} and the VC generator (info?.subject ?? {id}) keeps that empty
	// object, so verifiableCredentialCreate fails with guard.objectValue on an empty
	// subject. A static public source gives the consumer a non-empty subject so the
	// negotiation trust token can be minted. (The empty-policyData -> empty-subject
	// path is a platform robustness gap; this static source is the supported
	// config-level workaround.)
	nodeEngineConfig.types.rightsManagementPolicyInformationSourceComponent = [
		{
			type: "static",
			options: {
				config: {
					information: [
						{
							accessMode: "public",
							objects: {
								"urn:dpi:consumer-profile": {
									"@context": "https://schema.org",
									"@type": "Organization"
								}
							}
						}
					]
				}
			}
		}
	];
}

/**
 * Initialise the engine for the extension.
 * @param engineCore The engine core instance.
 */
export async function extensionInitialiseEngine(engineCore: IEngineCore): Promise<void> {
	engineCore.addTypeInitialiser(
		"consumerClientComponent",
		"@twin-community.org/consumer-client",
		"consumerClientInitialiser"
	);
}

/**
 * Initialise the engine server for the extension.
 * @param engineCore The engine core instance.
 * @param engineServer The engine server instance.
 */
export async function extensionInitialiseEngineServer(
	engineCore: IEngineCore,
	engineServer: IEngineServer
): Promise<void> {
	engineServer.addRestRouteGenerator(
		"consumerClientComponent",
		"@twin-community.org/consumer-client",
		"generateRestRoutes"
	);
}

/**
 * Initializer Component.
 * @param engineCore The engine core.
 * @param context The context for the engine.
 * @param instanceConfig The instance config.
 * @param instanceConfig.options The instance config options.
 * @param instanceConfig.type The instance type.
 * @returns The instance created and the factory for it.
 */
export function consumerClientInitialiser(
	engineCore: IEngineCore<IEngineConfig>,
	context: IEngineCoreContext,
	instanceConfig: {
		type: "service";
		options: IConsumerClientConstructorOptions;
	}
): EngineTypeInitialiserReturn<typeof instanceConfig, typeof ComponentFactory> {
	let instanceTypeName: string | undefined;
	let createComponent;

	if (instanceConfig.type === "service") {
		createComponent = (createConfig: typeof instanceConfig) =>
			new ConsumerClient(
				EngineTypeHelper.mergeConfig<IConsumerClientConstructorOptions>(
					{
						loggingComponentType: engineCore.getRegisteredInstanceType("loggingComponent"),

						dataspaceControlPlaneComponentType: engineCore.getRegisteredInstanceType(
							"dataspaceControlPlaneComponent"
						),

						trustComponentType: engineCore.getRegisteredInstanceType("trustComponent"),

						federatedCatalogueComponentType: engineCore.getRegisteredInstanceType(
							"federatedCatalogueComponent",
							["remote"]
						),

						// The provider's data plane is reached via the remote RestClient. Resolve its
						// registered engine instance type ("dataspace-data-plane-rest-client") so getData's
						// ComponentFactory.create uses the right name instead of the bare enum value.
						dataspaceDataPlaneOfDataProviderComponentType: engineCore.getRegisteredInstanceType(
							"dataspaceDataPlaneComponent",
							["remote"]
						)
					},
					createConfig.options
				)
			);
		instanceTypeName = "consumerClientComponent";
	}

	return {
		createComponent,
		instanceTypeName,
		factory: ComponentFactory
	};
}

/**
 * Generate the rest routes for the component.
 * @param baseRouteName The base route name.
 * @param componentName The component name.
 * @returns The rest routes.
 */
export function generateRestRoutes(baseRouteName: string, componentName: string): IRestRoute[] {
	const consumerClientRoute: IRestRoute<{ body: IConsumerRequest }, { body: unknown }> = {
		operationId: "consumerClient",
		summary: "Get Data",
		method: "POST",
		tag: "client",
		path: `${baseRouteName}/query-data`,
		handler: async (httpRequestContext, request) =>
			consumerGetData(httpRequestContext, componentName, request),
		requestType: {
			type: "unknown",
			examples: []
		},
		responseType: [
			{
				type: "unknown",
				examples: []
			}
		]
	};

	const negotiateRoute: IRestRoute<
		{ body: { datasetId: string } },
		{ body: { agreementId: string } }
	> = {
		operationId: "negotiate",
		summary: "Negotiate Data",
		method: "POST",
		tag: "negotiation",
		path: `${baseRouteName}/negotiate`,
		handler: async (httpRequestContext, request) =>
			negotiate(httpRequestContext, componentName, request),
		requestType: {
			type: "unknown",
			examples: []
		},
		responseType: [
			{
				type: "unknown",
				examples: []
			}
		]
	};

	return [consumerClientRoute, negotiateRoute];
}

/**
 * Get data.
 * @param httpRequestContext The request context for the API.
 * @param componentName The name of the component to use in the routes.
 * @param request The request.
 * @param request.body The body
 * @param request.body.datasetId The datasetId
 * @returns The response object with additional http response properties.
 */
export async function negotiate(
	httpRequestContext: IHttpRequestContext,
	componentName: string,
	request: { body: { datasetId: string } }
): Promise<{ body: { agreementId: string } }> {
	const component = ComponentFactory.get<IConsumerClientComponent>(componentName);
	const result = await component.negotiate(request.body.datasetId);

	return {
		body: {
			agreementId: result
		}
	};
}

/**
 * Get data.
 * @param httpRequestContext The request context for the API.
 * @param componentName The name of the component to use in the routes.
 * @param request The request.
 * @param request.body The body string params.
 * @returns The response object with additional http response properties.
 */
export async function consumerGetData(
	httpRequestContext: IHttpRequestContext,
	componentName: string,
	request: { body: IConsumerRequest }
): Promise<{ body: unknown }> {
	const component = ComponentFactory.get<IConsumerClientComponent>(componentName);
	const result = await component.getData(request.body);

	return {
		body: result
	};
}
