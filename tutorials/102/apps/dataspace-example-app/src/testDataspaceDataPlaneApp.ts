// Copyright 2025 IOTA Stiftung.
// SPDX-License-Identifier: Apache-2.0.
import {
	AuditableItemGraphContexts,
	AuditableItemGraphTypes,
	type IAuditableItemGraphComponent,
	type IAuditableItemGraphVertex
} from "@twin.org/auditable-item-graph-models";
import { ContextIdHelper, ContextIdKeys, ContextIdStore } from "@twin.org/context";
import { ArrayHelper, ComponentFactory, Guards } from "@twin.org/core";
import { DataTypeHandlerFactory } from "@twin.org/data-core";
import type { IJsonLdDocument } from "@twin.org/data-json-ld";
import {
	DataRequestType,
	type IDataspaceActivity,
	type IActivityQuery,
	type IDataRequest,
	type IDataspaceApp,
	type IProcessingGroupOptions
} from "@twin.org/dataspace-models";
import { LogLevel, type ILoggingComponent } from "@twin.org/logging-models";
import { nameof } from "@twin.org/nameof";
import type { IDataspaceProtocolDataset } from "@twin.org/standards-dataspace-protocol";
import type { IActivityStreamsActivity } from "@twin.org/standards-w3c-activity-streams";
import type { ITestAppConstructorOptions } from "./ITestAppConstructorOptions.js";

// Default consignments — two entries with different port locations for filtering tests.
// Can be overridden via constructor options (e.g. loaded from a JSON file via @json: env syntax).
const DEFAULT_CONSIGNMENTS: IJsonLdDocument[] = [
	{
		"@context": "https://vocabulary.uncefact.org/unece-context-D23B.jsonld",
		type: "Consignment",
		id: "urn:ucr:24PLP051219453I002610799053311",
		identifier: "M-Test0001",
		globalId: "5-GB-IMPORT-Test0001",
		destinationCountry: {
			type: "Country",
			countryId: "unece:CountryId#GB"
		},
		loadingLocation: {
			type: "LogisticsLocation",
			id: "unece:LOCODE#NLRTM",
			name: "Rotterdam"
		},
		unloadingLocation: {
			type: "LogisticsLocation",
			id: "unece:LOCODE#GBFXT",
			name: "Felixstowe"
		}
	},
	{
		"@context": "https://vocabulary.uncefact.org/unece-context-D23B.jsonld",
		type: "Consignment",
		id: "urn:ucr:24PLP051219453I002710888164422",
		identifier: "M-Test0002",
		globalId: "5-GB-IMPORT-Test0002",
		destinationCountry: {
			type: "Country",
			countryId: "unece:CountryId#GB"
		},
		loadingLocation: {
			type: "LogisticsLocation",
			id: "unece:LOCODE#FRLEH",
			name: "Le Havre"
		},
		unloadingLocation: {
			type: "LogisticsLocation",
			id: "unece:LOCODE#GBDVR",
			name: "Dover"
		}
	}
];

const DEFAULT_ENTITIES: IJsonLdDocument[] = [
	DEFAULT_CONSIGNMENTS[0],
	{
		"@context": "https://vocabulary.uncefact.org/unece-context-D23B.jsonld",
		type: "Document",
		id: "urn:document:a3456fddaa56",
		documentTypeCode: "unece:DocumentCodeList#853"
	}
];

/**
 * Test App Activity Handler.
 */
export class TestDataspaceDataPlaneApp implements IDataspaceApp {
	/**
	 * App Name.
	 */
	public static readonly APP_ID = "https://vtwt-1.virtualwatchtower.org";

	/**
	 * Runtime name for the class.
	 */
	public static readonly CLASS_NAME: string = nameof<TestDataspaceDataPlaneApp>();

	/**
	 * Logging component.
	 * @internal
	 */
	private readonly _logging?: ILoggingComponent;

	/**
	 * Auditable Item Graph Component
	 * @internal
	 */
	private readonly _auditableItemGraph: IAuditableItemGraphComponent;

	/**
	 * Consignment documents served by this app.
	 * @internal
	 */
	private readonly _consignments: IJsonLdDocument[];

	/**
	 * Node Identity
	 * @internal
	 */
	private _nodeId?: string;

	/**
	 * Create a new instance of TestDataspaceDataPlaneApp.
	 * @param options The constructor options.
	 */
	constructor(options?: ITestAppConstructorOptions) {
		this._logging = ComponentFactory.getIfExists<ILoggingComponent>(
			options?.loggingComponentType ?? "logging"
		);
		this._consignments = options?.consignments ?? DEFAULT_CONSIGNMENTS;

		this._auditableItemGraph = ComponentFactory.get<IAuditableItemGraphComponent>(
			options?.auditableItemGraphComponentType ?? "auditable-item-graph"
		);
	}

	/**
	 * Returns the class name of the component.
	 * @returns The class name of the component.
	 */
	public className(): string {
		return TestDataspaceDataPlaneApp.CLASS_NAME;
	}

	/**
	 * The settings for the processing groups for tasks.
	 * @returns The options for each process group.
	 */
	public processingGroups(): {
		[id: string]: IProcessingGroupOptions;
	} {
		return {
			"test-default": {
				concurrentTasks: 2
			}
		};
	}

	/**
	 * Supported query types.
	 * @returns Types.
	 */
	public supportedQueryTypes(): string[] {
		return ["TestQueryType"];
	}

	/**
	 * Start method.
	 * @param nodeLoggingComponentType the logging component type of such a node.
	 */
	public async start(nodeLoggingComponentType?: string): Promise<void> {
		const contextIds = await ContextIdStore.getContextIds();
		ContextIdHelper.guard(contextIds, ContextIdKeys.Node);
		this._nodeId = contextIds[ContextIdKeys.Node];

		DataTypeHandlerFactory.register("https://vocabulary.uncefact.org/Consignment", () => ({
			namespace: "https://vocabulary.uncefact.org/",
			type: "Consignment",
			defaultValue: {},
			jsonSchema: async () => ({
				type: "object"
			})
		}));
	}

	/**
	 * The activities handled by the App.
	 * @returns The activities handled by the App.
	 */
	public activitiesHandled(): IActivityQuery[] {
		return [
			{
				objectType: "https://vocabulary.uncefact.org/Consignment",
				processingGroupId: "test-default"
			}
		];
	}

	/**
	 * Handle Activity.
	 * @param activity Activity
	 * @returns Activity processing result
	 */
	public async handleActivity<T>(activity: IDataspaceActivity): Promise<T> {
		Guards.object<IActivityStreamsActivity>(
			TestDataspaceDataPlaneApp.CLASS_NAME,
			nameof(activity),
			activity
		);

		await this._logging?.log({
			level: LogLevel.Info,
			source: TestDataspaceDataPlaneApp.CLASS_NAME,
			message: `App Called: ${TestDataspaceDataPlaneApp.APP_ID}`
		});

		await this._logging?.log({
			level: LogLevel.Info,
			source: TestDataspaceDataPlaneApp.CLASS_NAME,
			message: `Node Identity: ${this._nodeId ?? ""}`
		});

		Guards.object(TestDataspaceDataPlaneApp.CLASS_NAME, nameof(activity.object), activity.object);

		const vertex: Omit<IAuditableItemGraphVertex, "id"> = {
			"@context": [AuditableItemGraphContexts.Context, AuditableItemGraphContexts.ContextCommon],
			type: AuditableItemGraphTypes.Vertex,
			annotationObject: ArrayHelper.fromObjectOrArray(activity.object)[0]
		};
		const vertexId = await this._auditableItemGraph.create(vertex);

		await this._logging?.log({
			level: LogLevel.Info,
			source: TestDataspaceDataPlaneApp.CLASS_NAME,
			message: `Vertex created: ${vertexId}`
		});

		return vertexId as T;
	}

	/**
	 * Handles the Data Request.
	 * @param dataRequest The data request
	 * @param cursor Cursor that points to the next item in the result set.
	 * @param limit Maximum number of entries retrieved or to be retrieved.
	 * @returns the Data.
	 */
	public async handleDataRequest(
		dataRequest: IDataRequest,
		cursor?: string,
		limit?: number
	): Promise<{ data: IJsonLdDocument; cursor?: string }> {
		Guards.object<IDataRequest>(
			TestDataspaceDataPlaneApp.CLASS_NAME,
			nameof(dataRequest),
			dataRequest
		);

		switch (dataRequest.type) {
			case DataRequestType.DataAssetEntities: {
				if (dataRequest.entitySet.entityId) {
					const entityIds = dataRequest.entitySet.entityId;
					const matched = this._consignments.filter(c =>
						entityIds.includes((c as { id?: string }).id ?? "")
					);
					return { data: (matched.length === 1 ? matched[0] : matched) as IJsonLdDocument };
				}

				if (dataRequest.entitySet.entityType === "https://vocabulary.uncefact.org/Consignment") {
					return {
						data: this._consignments as unknown as IJsonLdDocument
					};
				}

				return { data: [] };
			}

			case DataRequestType.QueryDataAsset:
				return { data: DEFAULT_ENTITIES as unknown as IJsonLdDocument };
		}
	}
}
