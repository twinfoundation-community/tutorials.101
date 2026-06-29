// Copyright 2025 IOTA Stiftung.
// SPDX-License-Identifier: Apache-2.0.
import type { IRestRoute } from "@twin.org/api-models";
import { Is } from "@twin.org/core";
import { DataspaceAppFactory } from "@twin.org/dataspace-models";
import type {
	EngineTypeInitialiserReturn,
	IEngineCore,
	IEngineCoreConfig,
	IEngineCoreContext,
	IEngineServer
} from "@twin.org/engine-models";
import { type IEngineConfig, EngineTypeHelper } from "@twin.org/engine-types";
import type { ITestAppConstructorOptions } from "./ITestAppConstructorOptions.js";
import { TestDataspaceDataPlaneApp } from "./testDataspaceDataPlaneApp.js";

/**
 * Initialise the  extension.
 * @param envVars The environment variables for the node.
 * @param nodeEngineConfig The node engine config.
 */
export async function extensionInitialise(
	envVars: { [id: string]: string | unknown },
	nodeEngineConfig: IEngineCoreConfig
): Promise<void> {
	nodeEngineConfig.types.testAppComponent = [
		{
			type: "service",
			options: {
				consignments: Is.arrayValue(envVars.testAppConsignments)
					? envVars.testAppConsignments
					: undefined
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
		"testAppComponent",
		"@twin-community.org/dataspace-example-app",
		"testAppInitialiser"
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
		"testAppComponent",
		"@twin-community.org/dataspace-example-app",
		"generateRestRoutes"
	);
}

/**
 * Test Dataspace Data Plane App initializer.
 * @param engineCore The engine core.
 * @param context The context for the engine.
 * @param instanceConfig The instance config.
 * @param instanceConfig.options The instance config options.
 * @param instanceConfig.type The instance type.
 * @returns The instance created and the factory for it.
 */
export function testAppInitialiser(
	engineCore: IEngineCore<IEngineConfig>,
	context: IEngineCoreContext,
	instanceConfig: { type: "service"; options: ITestAppConstructorOptions }
): EngineTypeInitialiserReturn<typeof instanceConfig, typeof DataspaceAppFactory> {
	let instanceTypeName: string | undefined;
	let createComponent;

	if (instanceConfig.type === "service") {
		createComponent = (createConfig: typeof instanceConfig) =>
			new TestDataspaceDataPlaneApp(
				EngineTypeHelper.mergeConfig<ITestAppConstructorOptions>(
					{
						loggingComponentType: engineCore.getRegisteredInstanceType("loggingComponent"),
						auditableItemGraphComponentType: engineCore.getRegisteredInstanceType(
							"auditableItemGraphComponent"
						)
					},
					createConfig.options
				)
			);
		instanceTypeName = TestDataspaceDataPlaneApp.APP_ID;
	}

	return {
		instanceTypeName,
		factory: DataspaceAppFactory,
		createComponent
	};
}

/**
 * Generate the rest routes for the component.
 * @param baseRouteName The base route name.
 * @param componentName The component name.
 * @returns The rest routes.
 */
export function generateRestRoutes(baseRouteName: string, componentName: string): IRestRoute[] {
	return [];
}
