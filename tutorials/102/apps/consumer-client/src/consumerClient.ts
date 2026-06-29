// Copyright 2025 IOTA Stiftung.
// SPDX-License-Identifier: Apache-2.0.

/* eslint-disable jsdoc/require-jsdoc */
/* eslint-disable no-restricted-syntax */

import { ContextIdKeys, ContextIdStore, type IContextIds } from "@twin.org/context";
import { ComponentFactory, type IError, Is } from "@twin.org/core";
import {
	DataspaceTransferFormat,
	type IDataspaceDataPlaneComponent,
	type IDataspaceControlPlaneComponent
} from "@twin.org/dataspace-models";
import type { IFederatedCatalogueComponent } from "@twin.org/federated-catalogue-models";
import { type ILoggingComponent, LogLevel } from "@twin.org/logging-models";
import {
	DataspaceProtocolCatalogTypes,
	type IDataspaceProtocolDataset,
	type DataspaceProtocolContractNegotiationStateType,
	type DataspaceProtocolTransferProcessStateType,
	type IDataspaceProtocolAgreement,
	type IDataspaceProtocolDataService,
	type IDataspaceProtocolOffer,
	type IDataspaceProtocolTransferStartMessage
} from "@twin.org/standards-dataspace-protocol";
import type { ITrustComponent } from "@twin.org/trust-models";
import type { IConsumerClientComponent } from "./IConsumerClientComponent.js";
import type { IConsumerClientConstructorOptions } from "./IConsumerClientConstructorOptions.js";
import type { IConsumerRequest } from "./IConsumerRequest.js";

/**
 * Test App Activity Handler.
 */
export class ConsumerClient implements IConsumerClientComponent {
	private readonly _logging: ILoggingComponent;

	private readonly _dataspaceControlPlane: IDataspaceControlPlaneComponent;

	private readonly _trustComponent: ITrustComponent;

	private readonly _federatedCatalogue: IFederatedCatalogueComponent;

	// The registered type name of the data-plane REST client used to pull data from the provider.
	// This is the engine instance type ("dataspace-data-plane-rest-client"), NOT the component-type
	// enum value ("rest-client"); passing the enum to ComponentFactory.create throws factory.noCreate.
	private readonly _dataspaceDataPlaneOfDataProviderComponentType: string;

	/**
	 * Create a new instance.
	 * @param options The constructor options.
	 */
	constructor(options?: IConsumerClientConstructorOptions) {
		this._dataspaceControlPlane = ComponentFactory.get<IDataspaceControlPlaneComponent>(
			options?.dataspaceControlPlaneComponentType ?? "dataspaceControlPlane"
		);

		this._logging = ComponentFactory.get<ILoggingComponent>(
			options?.loggingComponentType ?? "dataspaceControlPlane"
		);

		this._trustComponent = ComponentFactory.get<ITrustComponent>(
			options?.trustComponentType ?? "trust"
		);

		this._federatedCatalogue = ComponentFactory.get<IFederatedCatalogueComponent>(
			options?.federatedCatalogueComponentType ?? "federatedCatalogue"
		);

		this._dataspaceDataPlaneOfDataProviderComponentType =
			options?.dataspaceDataPlaneOfDataProviderComponentType ?? "dataspace-data-plane-rest-client";
	}

	public className(): string {
		return "ConsumerClient";
	}

	public async getData(dataRequest: IConsumerRequest): Promise<unknown> {
		// eslint-disable-next-line no-async-promise-executor
		return new Promise<unknown>(async (resolve, reject) => {
			try {
				const ids = (await ContextIdStore.getContextIds()) as IContextIds;

				// Trust tokens are identity-only and the identity IS the tenant's
				// organization DID from the request context.
				const consumerIdentity = ids[ContextIdKeys.Organization] as string;

				const token = await this._trustComponent.generate(consumerIdentity, undefined, {});

				const { providerEndpoint } = await this.getDatasetDetails(dataRequest.entityType, token);

				const format = DataspaceTransferFormat.HttpDataPull;

				const transferCallbackId = `transfer-${new Date().toISOString()}`;
				this._dataspaceControlPlane.registerTransferCallback(transferCallbackId, {
					onStarted: async (
						consumerPid: string,
						message: IDataspaceProtocolTransferStartMessage
					) => {
						try {
							await this._logging.log({
								level: LogLevel.Debug,
								message: `TransferProcess: ${consumerPid} Now started: channel: ${message.dataAddress?.endpoint}`,
								source: this.className()
							});
							// Retrieve the data
							const endpoint = message.dataAddress?.endpoint;
							if (Is.undefined(endpoint)) {
								reject(new Error(`No data address supplied for transfer process ${consumerPid}`));
								return;
							}
							// pathPrefix:"" so the client treats the advertised channel as the data-plane base
							// and only appends its own "/entities" route (and merges the endpoint's
							// ?organization tenant-routing param). Without it the client would prepend its
							// default "dataspace-data-plane" prefix and 404. Mirrors the remote control-plane
							// create in dataspaceControlPlaneService.prepareTransfer.
							const dataProviderDataPlane = ComponentFactory.create<IDataspaceDataPlaneComponent>(
								this._dataspaceDataPlaneOfDataProviderComponentType,
								{
									endpoint,
									pathPrefix: ""
								}
							);
							const entities = await dataProviderDataPlane.getDataAssetEntities(
								{
									entityType: dataRequest.entityType,
									entityId: dataRequest.entityId
								},
								consumerPid,
								undefined,
								undefined,
								token
							);

							resolve(entities.itemList);
						} catch (error) {
							await this._logging.log({
								level: LogLevel.Error,
								source: this.className(),
								message: `Error while handling "onStarted": ${JSON.stringify(error)}`
							});
							reject(error);
						}
					},
					onStateChanged: async (
						consumerPid: string,
						state: DataspaceProtocolTransferProcessStateType
					) => {
						await this._logging.log({
							level: LogLevel.Debug,
							message: `TransferProcess: ${consumerPid} Now in state: ${state}`,
							source: this.className()
						});
					},

					onCompleted: async (consumerPid: string) => {},

					onSuspended: async (consumerPid: string, reason?: string) => {},

					onTerminated: async (consumerPid: string, reason?: string) => {},

					onFailed: async (consumerPid: string, reason: string) => {
						await this._logging.log({
							level: LogLevel.Error,
							source: this.className(),
							message: `Transfer Process: ${consumerPid} failed: ${reason}`
						});
						this._dataspaceControlPlane.unregisterTransferCallback(transferCallbackId);

						reject(new Error(`Transfer Process: ${consumerPid} failed: ${reason}`));
					},

					onTimeout: async (consumerPid: string) => {
						await this._logging.log({
							level: LogLevel.Error,
							source: this.className(),
							message: `Transfer Process: ${consumerPid} timed out`
						});
						this._dataspaceControlPlane.unregisterTransferCallback(transferCallbackId);

						reject(new Error(`Transfer Process: ${consumerPid} failed due to timeout`));
					}
				});

				const providerEndpointTransfer = new URL(providerEndpoint);
				providerEndpointTransfer.pathname += "dataspace";

				// prepareTransfer no longer takes a consumer callback address; the platform
				// reads it from the request context (HttpContextIdKeys.PublicOrigin =
				// this node's DPI_NODE_PUBLIC_ORIGIN).
				const transferResult = await this._dataspaceControlPlane.prepareTransfer(
					dataRequest.agreementId,
					providerEndpointTransfer.toString(),
					format,
					token
				);

				await this._logging.log({
					level: LogLevel.Debug,
					source: this.className(),
					message: `Transfer Process Initiated. Consumer Pid: ${transferResult.consumerPid}`
				});
			} catch (error) {
				await this._logging.log({
					level: LogLevel.Error,
					source: this.className(),
					message: `General Error in the service: ${JSON.stringify(error)}`
				});
				reject(error);
			}
		});
	}

	public async negotiate(entityType: string): Promise<string> {
		// eslint-disable-next-line no-async-promise-executor
		return new Promise<string>(async (resolve, reject) => {
			try {
				const ids = (await ContextIdStore.getContextIds()) as IContextIds;

				// Trust tokens are identity-only and the identity IS the tenant's
				// organization DID from the request context.
				const consumerIdentity = ids[ContextIdKeys.Organization] as string;

				const token = await this._trustComponent.generate(consumerIdentity, undefined, {});

				const { datasetId, datasetPolicyId, providerEndpoint } = await this.getDatasetDetails(
					entityType,
					token
				);

				const negotiationCallbackId = `negotiation-${new Date().toISOString()}`;

				this._dataspaceControlPlane.registerNegotiationCallback(negotiationCallbackId, {
					// Handles on state change CN
					// ///////////////////////////
					onStateChanged: async (
						negotiationId: string,
						state: DataspaceProtocolContractNegotiationStateType,
						data?: {
							offer?: IDataspaceProtocolOffer;
							agreement?: IDataspaceProtocolAgreement;
						}
					) => {
						await this._logging.log({
							level: LogLevel.Debug,
							message: `Negotiation: ${negotiationId}, Now in state: ${state}`,
							source: this.className()
						});
					},
					// Handles on completed CN
					// ///////////////////////////
					onFinalized: async (negotiationId: string, agreementId: string) => {
						this._dataspaceControlPlane.unregisterNegotiationCallback(negotiationCallbackId);

						await this._logging.log({
							level: LogLevel.Debug,
							message: `Negotiation: ${negotiationId} Now Completed. Agreement: ${agreementId}`,
							source: this.className()
						});

						resolve(agreementId);
					},
					// Handles on failed CN
					// ///////////////////////////
					onFailed: async (negotiationId: string, reason: string) => {
						await this._logging.log({
							level: LogLevel.Error,
							source: this.className(),
							message: `Negotiation: ${negotiationId} failed: ${reason}`
						});
						this._dataspaceControlPlane.unregisterNegotiationCallback(negotiationCallbackId);

						reject(new Error(`Negotiation: ${negotiationId} failed: ${reason}`));
					},

					onTimeout: async (negotiationId: string) => {
						await this._logging.log({
							level: LogLevel.Error,
							source: this.className(),
							message: `Negotiation: ${negotiationId} failed due to timeout`
						});
						reject(new Error(`Negotiation: ${negotiationId} timed out`));
					}
				});

				const negotiationProviderEndpoint = new URL(providerEndpoint);
				negotiationProviderEndpoint.pathname += "rights-management";

				// Everything starts with a Contract Negotiation
				const negotiationId = await this._dataspaceControlPlane.negotiateAgreement(
					datasetId,
					datasetPolicyId,
					negotiationProviderEndpoint.toString(),
					token
				);

				await this._logging.log({
					level: LogLevel.Debug,
					source: this.className(),
					message: `Negotiation started. Id: ${negotiationId.negotiationId}`
				});
			} catch (error) {
				await this._logging.log({
					level: LogLevel.Error,
					source: this.className(),
					message: `General Error in the service: ${JSON.stringify(error)}`,
					error: error as IError
				});
				reject(error);
			}
		});
	}

	/**
	 * Start method.
	 * @param nodeLoggingComponentType Node Logging Component
	 */
	public async start(nodeLoggingComponentType?: string): Promise<void> {}

	/**
	 * Queries the catalog to obtain data.
	 * @param datasetDataType dataset data type.
	 * @param token to use.
	 * @returns provider endpoint.
	 * @throws Error
	 */
	private async getDatasetDetails(
		datasetDataType: string,
		token: unknown
	): Promise<{ providerEndpoint: string; datasetId: string; datasetPolicyId: string }> {
		// Query the federated Catalogue
		const catalogResponse = await this._federatedCatalogue.query(
			[
				{
					"@type": "FilterByMetadata",
					"dcterms:type": datasetDataType
				}
			],
			undefined,
			undefined,
			token
		);

		if (catalogResponse.result["@type"] === DataspaceProtocolCatalogTypes.CatalogError) {
			const catalogError = catalogResponse.result;
			throw new Error(catalogError.code);
		}

		const catalog = catalogResponse.result;
		if (!Is.arrayValue(catalog.catalog) && !Is.arrayValue(catalog.dataset)) {
			throw new Error(`Catalog query did not return any dataset: ${datasetDataType}`);
		}
		let dataset: IDataspaceProtocolDataset | undefined;

		if (Is.arrayValue(catalog.dataset)) {
			dataset = catalog.dataset[0] as IDataspaceProtocolDataset;
		}
		if (Is.arrayValue(catalog.catalog)) {
			const catalogItem = catalog.catalog[0];
			if (!Is.arrayValue(catalogItem.dataset)) {
				throw new Error(`Catalog query did not return any dataset: ${datasetDataType}`);
			}
			dataset = catalogItem.dataset[0] as IDataspaceProtocolDataset;
		}

		if (Is.undefined(dataset)) {
			throw new Error(`Catalog query did not return any dataset: ${datasetDataType}`);
		}

		const datasetId = dataset["@id"];
		const datasetPolicyId = dataset.hasPolicy[0]["@id"];

		const providerEndpoint = (
			dataset.distribution[0].accessService as IDataspaceProtocolDataService
		).endpointURL;

		await this._logging.log({
			level: LogLevel.Debug,
			message: `DatasetId: ${datasetId}, Policy: ${datasetPolicyId}, Endpoint URL: ${providerEndpoint}`,
			source: this.className()
		});

		return { providerEndpoint, datasetId, datasetPolicyId };
	}
}
