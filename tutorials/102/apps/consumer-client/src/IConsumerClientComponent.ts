// Copyright 2025 IOTA Stiftung.
// SPDX-License-Identifier: Apache-2.0.

import type { IComponent } from "@twin.org/core";
import type { IConsumerRequest } from "./IConsumerRequest.js";

/**
 * Consumer client component
 */
export interface IConsumerClientComponent extends IComponent {
	/**
	 * Get data
	 * @param dataRequest the Data request.
	 * @returns unknown
	 */
	getData(dataRequest: IConsumerRequest): Promise<unknown>;

	/**
	 * Negotiates over a dataset passing id as parameter.
	 * @param entityType The type of entity to negotiate over.
	 * @returns agreement Id
	 */
	negotiate(entityType: string): Promise<string>;
}
