# Consumer Client Example

> Created: 2026-06-19
> Last updated: 2026-06-23

It uses the Contract Negotation point and DS Control Plane to perform a negotiation. Finally a Data Transfer is conducted via the Data Plane.

The Consumer get access to the dataset published by the publisher.

Two routes drive the flow:

- `POST /consumer-client/negotiate` discovers the dataset in the provider's catalogue and runs the full DSP contract negotiation to `FINALIZED`, returning the `agreementId`.
- `POST /consumer-client/query-data` (body `{ "agreementId": "...", "entityType": "..." }`) transfers and pulls the data in a single call. The provider runs `DPI_NODE_DATASPACE_AUTO_START_TRANSFERS="true"`, so this one call drives request, provider auto-start, the start callback to the consumer's control plane, and the consumer-side pull via the data-plane client. It returns `{ "itemList": { "type": "ItemList", "itemListElement": [ ... ] } }`.
