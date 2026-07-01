// Copyright 2025 IOTA Stiftung.
// SPDX-License-Identifier: Apache-2.0.
import {
	AuditableItemGraphContexts,
	AuditableItemGraphTypes,
	type IAuditableItemGraphComponent,
	type IAuditableItemGraphVertex
} from "@twin.org/auditable-item-graph-models";
import { ContextIdHelper, ContextIdKeys, ContextIdStore } from "@twin.org/context";
import { ArrayHelper, ComponentFactory, Guards, Is, ObjectHelper } from "@twin.org/core";
import { DataTypeHandlerFactory } from "@twin.org/data-core";
import type { IJsonLdDocument, IJsonLdNodeObject } from "@twin.org/data-json-ld";
import {
	DataRequestType,
	type IDataspaceActivity,
	type IActivityQuery,
	type IDataRequest,
	type IDataspaceApp,
	type IProcessingGroupOptions
} from "@twin.org/dataspace-models";
import { ComparisonOperator, LogicalOperator, type IComparator } from "@twin.org/entity";
import { LogLevel, type ILoggingComponent } from "@twin.org/logging-models";
import { nameof } from "@twin.org/nameof";
import { SchemaOrgContexts, SchemaOrgTypes } from "@twin.org/standards-schema-org";
import { UneceContexts, UneceTypes } from "@twin.org/standards-unece";
import type { IActivityStreamsActivity } from "@twin.org/standards-w3c-activity-streams";
import type { ITestAppConstructorOptions } from "./ITestAppConstructorOptions.js";

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
				if (Is.arrayValue(dataRequest.entitySet.entityId)) {
					const entityIds = dataRequest.entitySet.entityId;
					const conditions: IComparator[] = [];
					// The AIG will perform an OR over the entity Ids
					for (const entityId of entityIds) {
						conditions.push({
							property: "annotationObject.globalId",
							value: entityId,
							comparison: ComparisonOperator.Equals
						});
					}

					const items = await this._auditableItemGraph.query(undefined, {
						logicalOperator: LogicalOperator.Or,
						conditions
					});
					const data = {
						"@context": SchemaOrgContexts.Context,
						type: SchemaOrgTypes.ItemList
					};
					const itemListElement: IJsonLdNodeObject[] = [];
					for (const item of items.entries.itemListElement) {
						if (item.annotationObject?.type === UneceTypes.Consignment) {
							itemListElement.push(item.annotationObject);
						}
					}
					ObjectHelper.propertySet(data, "itemListElement", itemListElement);
					return { data: itemListElement };
				}

				if (
					dataRequest.entitySet.entityType === `${UneceContexts.Namespace}${UneceTypes.Consignment}`
				) {
					const conditions: IComparator[] = [
						{
							property: "annotationObject.type",
							value: UneceTypes.Consignment,
							comparison: ComparisonOperator.Equals
						}
					];

					const items = await this._auditableItemGraph.query(undefined, {
						conditions,
						logicalOperator: LogicalOperator.Or
					});
					const data = {
						"@context": SchemaOrgContexts.Context,
						type: SchemaOrgTypes.ItemList
					};
					const itemListElement: IJsonLdNodeObject[] = [];
					for (const item of items.entries.itemListElement) {
						itemListElement.push(item.annotationObject as IJsonLdNodeObject);
					}
					ObjectHelper.propertySet(data, "itemListElement", itemListElement);
					return { data: itemListElement };
				}

				return { data: [] };
			}
			case DataRequestType.QueryDataAsset:
				// Not supported in this example
				return { data: [] };
		}
	}
}
