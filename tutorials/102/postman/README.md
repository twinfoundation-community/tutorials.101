# TWIN 102 — DSP Postman Walkthrough (per-request reference)

> **⚠️ #203 update (2026-06-11):** collection + environment migrated to organization identifiers — `?organization=<org-did>` routing on all non-login requests, per-tenant org DIDs in `prov_did`/`cons_did`, `FilterByMetadata`, no tenant tokens. See the note at the top of `../dsp-postman-walkthrough.md`.

End-to-end DSP data transfer for tutorials/102. Two files in this directory:

- `TWIN-102-DSP.postman_collection.json` — import into Postman
- `TWIN-102-DSP.postman_environment.json` — import as a Postman environment

> 🟢 **If you want the practical "actually run this end-to-end" guide,** read [../dsp-postman-walkthrough.md](../dsp-postman-walkthrough.md) first. It explains the recommended shortcut, why C2/C3/C4 can't be driven from Postman alone, and how the platform actually works under the hood.

This README is the manual companion: every request, every header, every body, every expected response, every value to extract. Use it instead of (or alongside) the Postman collection.

---

## Prerequisites

- `tutorials/102` node up via `./build-extensions.sh && docker compose up -d` (`build-extensions.sh` builds the apps + strips bundled `@twin.org/*`; provider + consumer tenants bootstrapped with org DIDs via `twin-node.sh` + `onboard-org.sh`).
- The published image `twinfoundation/twin-node:0.9.1-next.2` (or newer) bakes all `@twin.org/*` on the `0.9.1-next` line (dataspace `0.9.1-next.4`, core `0.9.1-next.5`). On `0.9.1-next.x` the extensions must use the host's `@twin.org/*` at runtime: build them with `./build-extensions.sh` (it strips the bundled copies), else the node fails to start (`context ID "node" is missing`).
- `common/.env.local` has the two rights-management env vars (else the data-pull leg returns `noArbiters` / `noProcessors`):
  ```sh
  TWIN_RIGHTS_MANAGEMENT_POLICY_ARBITERS="pass-through"
  TWIN_RIGHTS_MANAGEMENT_POLICY_ENFORCEMENT_PROCESSORS="pass-through"
  ```
- `.env.multitenant` has `TWIN_DATASPACE_DATA_PLANE_PATH="dataspace/entities"` and `TWIN_DATASPACE_ENABLED="true"` — without the data-plane path, C5 returns `pullTransfersNotSupported`.

---

## Environment variables

Pre-filled in the environment JSON; overwrite per your setup.

| Var | Value (this tutorial) | Notes |
|---|---|---|
| `base` | `http://localhost:3000` | local node |
| `host_internal` | `http://host.docker.internal:3000` | how the node reaches itself for callbacks |
| `prov_api_key` | (from bootstrap) | provider tenant — routes **login only** (`/authentication/login`) |
| `cons_api_key` | (from bootstrap) | consumer tenant — routes login only |
| `prov_did` | `did:entity-storage:0x…` | provider tenant **org DID** — routes every non-login request (`?organization=`) + is the caller identity |
| `cons_did` | `did:entity-storage:0x…` | consumer tenant **org DID** (distinct from provider — per-tenant since #203) |
| `prov_email` / `cons_email` | `prov@example.com` / `cons@example.com` | from `data.md` |
| `prov_password` / `cons_password` | `yM5?NgPPAio+TmWx` | from `data.md` |
| `dataset_id` | `https://twin.example.org/dataset-1342` | matches `consumer-client/src/consumerClient.ts:41` |
| `dataset_type` | `https://vocabulary.uncefact.org/Consignment` | matches `consumer-client/src/consumerClient.ts:46` |
| `offer_id` | `urn:policy:test-policy-offer-1` | ODRL policy ID |
| `app_id` | `https://vtwt-1.virtualwatchtower.org` | matches `TestDataspaceDataPlaneApp.APP_ID` |

These are **populated as you go** (extraction scripts handle this in the collection):
`prov_session_jwt`, `cons_session_jwt`, `prov_trust_jwt`, `cons_trust_jwt`, `negotiation_id`, `agreement_id`, `consumer_pid`, `provider_pid`, `provider_pid_enc`, `data_endpoint`, `access_token`.

---

## How the collection wires requests together

Most requests have a **Post-response script** (in the Scripts tab) that extracts a single value from the response body and writes it to an environment variable. Login requests grab the `access_token` cookie. Trust-mint requests grab `response.jwt`. C5 grabs `dataAddress.endpoint` and the `authorization` value from `endpointProperties`. The next request then references the variable via `{{name}}` syntax in its URL / headers / body. Nothing magic — just `pm.environment.set('name', value)` calls visible in each request's Scripts tab.

The "Variables in request" panel that pops up only shows variables a request **uses**, not ones it **writes**. To see what got populated after running, click the eye icon (top-right, next to the env dropdown). If a script silently failed to populate something (re-import quirk, no env selected, script error), the universal fallback is to copy from the response body and paste into the env var's Current value column manually — see the comprehensive script-extraction map and troubleshooting in [../dsp-postman-walkthrough.md → What the auto-extraction scripts do](../dsp-postman-walkthrough.md#what-the-auto-extraction-scripts-do).

## Auth cheatsheet (post-#203)

Tenant routing: `?x-api-key=` works **only** on `/authentication/login`; every other request routes
by `?organization=<org-did>`. The `Authorization` bearer is independent (session JWT for admin
routes, trust JWT for cross-tenant DSP).

| Endpoint group | Routing query param | `Authorization: Bearer ...` |
|---|---|---|
| Login (A1/B1) | `?x-api-key={{prov_api_key}}` / `{{cons_api_key}}` | — (returns the session cookie) |
| Provider admin (offer, dataset, trust-mint) | `?organization={{prov_did}}` | `prov_session_jwt` |
| Consumer admin (catalogue, trust-mint) | `?organization={{cons_did}}` | `cons_session_jwt` (C1 uses `cons_trust_jwt`) |
| Cross-tenant DSP as consumer (negotiate, requestTransfer) | `?organization={{prov_did}}` (routes to provider) | `cons_trust_jwt` (caller identity) |
| Cross-tenant DSP as provider (`/transfers/:pid/start`) | `?organization={{prov_did}}` | `prov_trust_jwt` ← assigner is the provider |
| Data plane fetch | (org DID already baked into endpoint URL) | `access_token` ← from TransferStartMessage |

---

## A. Setup as provider (one-time)

### A1. Login as provider

```http
POST {{base}}/authentication/login?x-api-key={{prov_api_key}}
Content-Type: application/json

{
  "email": "{{prov_email}}",
  "password": "{{prov_password}}"
}
```

**Expect:** `200 OK`. Look at the `Set-Cookie` response header — it contains `access_token=<jwt>; ...`.

**Save:** the JWT from `access_token=` → `prov_session_jwt`.

> Postman extraction script (Tests tab):
> ```javascript
> const m = (pm.response.headers.get('Set-Cookie') || '').match(/access_token=([^;]+)/);
> if (m) pm.environment.set('prov_session_jwt', m[1]);
> ```

### A2. Mint provider trust JWT-VC

```http
POST {{base}}/identity/{{prov_did}}/verifiable-credential/trust-assertion?organization={{prov_did}}
Content-Type: application/json
Authorization: Bearer {{prov_session_jwt}}

{
  "subject": { "id": "{{prov_did}}" }
}
```

**Expect:** `200 OK`. Response is `{ "verifiableCredential": {...}, "jwt": "eyJ..." }`.

**Save:** `response.jwt` → `prov_trust_jwt`.

### A3. Create the ODRL Offer

Skip if `urn:policy:test-policy-offer-1` already exists (you'll get a 400 — fine).

```http
POST {{base}}/rights-management/policy/admin?organization={{prov_did}}
Content-Type: application/json
Authorization: Bearer {{prov_session_jwt}}

{
  "@context": "http://www.w3.org/ns/odrl.jsonld",
  "@type": "Offer",
  "@id": "{{offer_id}}",
  "assigner": "{{prov_did}}",
  "target": "{{dataset_id}}",
  "permission": [
    { "target": "{{dataset_id}}", "action": "use" }
  ]
}
```

**Critical points** (each caused a 400 in repro until corrected):
- `@id` must be in `urn:policy:` namespace.
- `@context` is `http://www.w3.org/ns/odrl.jsonld` (http, not https) — or an array.
- `target` must be **top-level** (the negotiator reads `policy.target`, not `permission[0].target`).

### A4. Register the Dataset

Skip if dataset already exists.

```http
POST {{base}}/dataspace-control-plane/app-datasets?organization={{prov_did}}
Content-Type: application/json
Authorization: Bearer {{prov_session_jwt}}

{
  "appId": "{{app_id}}",
  "dataset": {
    "@context": {
      "dcat":    "http://www.w3.org/ns/dcat#",
      "dcterms": "http://purl.org/dc/terms/",
      "odrl":    "http://www.w3.org/ns/odrl/2/"
    },
    "@type": "dcat:Dataset",
    "@id": "{{dataset_id}}",
    "dcterms:title": "Test Dataset 1342",
    "dcterms:type": "{{dataset_type}}",
    "dcterms:publisher": "{{prov_did}}",
    "dcat:distribution": {
      "@type": "dcat:Distribution",
      "dcterms:format": "application/json",
      "dcat:accessService": {
        "@type": "dcat:DataService",
        "dcat:endpointURL": "{{host_internal}}/"
      }
    },
    "odrl:hasPolicy": {
      "@context": "http://www.w3.org/ns/odrl.jsonld",
      "@type": "Offer",
      "@id": "{{offer_id}}",
      "assigner": "{{prov_did}}",
      "target": "{{dataset_id}}",
      "permission": [
        { "target": "{{dataset_id}}", "action": "use" }
      ]
    }
  }
}
```

**Critical points:**
- `@context` MUST be the **explicit prefix map** above, NOT the dspace `context.jsonld` URL (Bug 5: the validator looks for `dcterms:format`; the dspace context uses `dct:` instead).
- `odrl:hasPolicy` MUST be the **full Offer object**, not a stub `{"@id": "..."}` reference.
- `dcat:endpointURL` is the plain data origin; the **platform** bakes `?organization=<provider org DID>` into the published distribution at `set()` (no manual token).

---

## B. Setup as consumer (one-time)

### B1. Login as consumer

```http
POST {{base}}/authentication/login?x-api-key={{cons_api_key}}
Content-Type: application/json

{
  "email": "{{cons_email}}",
  "password": "{{cons_password}}"
}
```

**Save:** `access_token` cookie → `cons_session_jwt`.

### B2. Mint consumer trust JWT-VC

```http
POST {{base}}/identity/{{cons_did}}/verifiable-credential/trust-assertion?organization={{cons_did}}
Content-Type: application/json
Authorization: Bearer {{cons_session_jwt}}

{
  "subject": { "id": "{{cons_did}}" }
}
```

**Save:** `response.jwt` → `cons_trust_jwt`.

---

## C. DSP transfer flow (repeatable)

> ⚠️ **The callback-style C2/C3 below are reference-only** — they show the correct DSP shape but TERMINATE, because no REST endpoint creates the consumer-side negotiation record (the callback the provider pushes has nowhere to land). For a fully Postman-driven pull, use the **C-poll** folder (`C2′ → C3a′–e′ → C3f′`) to reach FINALIZED + capture `agreement_id`, then **C4 → C5 → C6** (all work from pure REST). The **C-shortcut** (two-call `POST /consumer-client/negotiate` then `POST /consumer-client/query-data`) is the automated alternative (Way 1; needs auto-start `"true"`). Full explanation: [../dsp-postman-walkthrough.md](../dsp-postman-walkthrough.md#why-c2c3c4-arent-100-postman-able).

### C1. Query the federated catalogue

```http
POST {{base}}/federated-catalogue/request?organization={{cons_did}}
Content-Type: application/json
Authorization: Bearer {{cons_trust_jwt}}

{
  "@context": ["https://w3id.org/dspace/2025/1/context.jsonld"],
  "@type": "CatalogRequestMessage",
  "filter": [
    { "@type": "FilterByMetadata", "dcterms:type": "{{dataset_type}}" }
  ]
}
```

**Expect:** Response is `{ "result": { "@type": "Catalog", "dataset": [ {...} ] } }`.

**Extract from `dataset[0]`:**
- `@id` → confirm `dataset_id`
- `hasPolicy[0]["@id"]` → confirm `offer_id` (may differ from the URN if the catalogue's policy IDs are auto-generated)

> ⚠️ `filter` **must** be an array (even if empty). `Guards.array` rejects `undefined`.

### C2. Initiate contract negotiation

The consumer is asking the provider to start a negotiation. The HTTP call is routed to the provider tenant (via `?organization={{prov_did}}`) but the bearer trust JWT identifies the consumer.

```http
POST {{base}}/rights-management/negotiations/request?organization={{prov_did}}
Content-Type: application/json
Authorization: Bearer {{cons_trust_jwt}}

{
  "@context": ["https://w3id.org/dspace/2025/1/context.jsonld"],
  "@type": "ContractRequestMessage",
  "consumerPid": "urn:uuid:GENERATE-FRESH-UUID-HERE",
  "offer": {
    "@type": "Offer",
    "@id": "{{offer_id}}",
    "target": "{{dataset_id}}"
  },
  "callbackAddress": "{{host_internal}}/rights-management?organization={{cons_did}}"
}
```

**Generate a fresh `consumerPid`** — `urn:uuid:` plus any unique UUID. The collection's Pre-request Script does this automatically.

> ⚠️ Note the `callbackAddress` path is `/rights-management`, not `/dataspace-control-plane`. The provider POSTs negotiation state-changes back to `{callbackAddress}/negotiations/{pid}/offers`, and that route lives in the PNP service mounted under `/rights-management/`. If you point it at `/dataspace-control-plane/`, the callback 404s and the negotiation TERMINATES.

**Save:** `response.providerPid` → `negotiation_id` (negotiations are keyed by `providerPid` on the provider side).

### C3. Poll until FINALIZED

```http
GET {{base}}/rights-management/negotiations/{{negotiation_id}}?organization={{prov_did}}
Authorization: Bearer {{cons_trust_jwt}}
```

Repeat until `response.state === "FINALIZED"`. With the `pass-through` negotiator this is usually 1–2 polls. Then:

**Save:** `response.agreement["@id"]` → `agreement_id`.

> Stuck at REQUESTED? Check node logs (`docker logs twin_node | tail -50`). Most likely: missing policy information sources or arbiters.

### C4. Request transfer (pull mode)

```http
POST {{base}}/dataspace-control-plane/transfers/request?organization={{prov_did}}
Content-Type: application/json
Authorization: Bearer {{cons_trust_jwt}}

{
  "@context": ["https://w3id.org/dspace/2025/1/context.jsonld"],
  "@type": "TransferRequestMessage",
  "agreementId": "{{agreement_id}}",
  "consumerPid": "urn:uuid:GENERATE-FRESH-UUID-HERE",
  "callbackAddress": "{{host_internal}}/dataspace-control-plane?organization={{cons_did}}",
  "format": "HttpData-PULL"
}
```

**Save:**
- Your generated `consumerPid` → `consumer_pid`
- `response.providerPid` → `provider_pid`
- URL-encoded `provider_pid` → `provider_pid_enc` (`:` → `%3A`)

### C5. Start the transfer

> ⚠️ **Bearer is `prov_trust_jwt` here**, NOT `cons_trust_jwt`. The agreement's `assigner` is the provider — `startTransfer`'s authorization check requires a provider-signed token. Using the consumer's token fails with `callerNotAuthorizedAsProvider`.

```http
POST {{base}}/dataspace-control-plane/transfers/{{provider_pid_enc}}/start?organization={{prov_did}}
Content-Type: application/json
Authorization: Bearer {{prov_trust_jwt}}

{
  "@context": ["https://w3id.org/dspace/2025/1/context.jsonld"],
  "@type": "TransferStartMessage",
  "consumerPid": "{{consumer_pid}}",
  "providerPid": "{{provider_pid}}"
}
```

**Expect:** Response is `TransferStartMessage` with a `dataAddress`:

```json
{
  "@context": ["https://w3id.org/dspace/2025/1/context.jsonld"],
  "@type": "TransferStartMessage",
  "consumerPid": "urn:uuid:...",
  "providerPid": "urn:uuid:...",
  "dataAddress": {
    "@type": "DataAddress",
    "endpointType": "https://schema.twindev.org/dspace/v1/Https-Query-Endpoint",
    "endpoint": "http://localhost:3000/dataspace/entities?organization=<provider-org-did>",
    "endpointProperties": [
      { "@type": "EndpointProperty", "name": "authorization", "value": "eyJ..." },
      { "@type": "EndpointProperty", "name": "authType", "value": "bearer" }
    ]
  }
}
```

**Save:**
- `response.dataAddress.endpoint` → `data_endpoint`
- The `endpointProperties` entry where `name === "authorization"` → its `value` → `access_token`

> Errors and what they mean:
> | Error code | Cause |
> |---|---|
> | `callerNotAuthorizedAsProvider` | Used `cons_trust_jwt` instead of `prov_trust_jwt` |
> | `pullTransfersNotSupported` | `dataPlanePath` not in the control-plane config (set `TWIN_DATASPACE_DATA_PLANE_PATH`) |
> | `invalidStateForStart` | Transfer process not in REQUESTED state — re-run C4 |

### C6. Fetch the data

```http
GET {{data_endpoint}}&consumerPid={{consumer_pid}}&type={{dataset_type}}
Authorization: Bearer {{access_token}}
```

> ⚠️ **In Postman, the URL must be ONLY the `raw` string above** — leave the **Params** tab empty. Do NOT split `consumerPid` / `type` into structured query params. (Post-#203 the endpoint carries a cleartext `?organization=<did>`, so the old encrypted-token re-encoding break is gone, but keeping everything in the raw URL bar still avoids Postman re-parsing surprises.)

**Expect:** `HTTP 200`. Response is a `schema.org` `ItemList` of Consignment entities:

```json
{
  "@context": "https://schema.org",
  "type": "ItemList",
  "itemListElement": [
    {
      "@context": "https://vocabulary.uncefact.org/unece-context-D23B.jsonld",
      "type": "Consignment",
      "id": "urn:ucr:24PLP051219453I002610799053311",
      "identifier": "M-Test0001",
      "loadingLocation":  { "id": "unece:LOCODE#NLRTM", "name": "Rotterdam" },
      "unloadingLocation":{ "id": "unece:LOCODE#GBFXT", "name": "Felixstowe" }
    },
    {
      "type": "Consignment",
      "id": "urn:ucr:24PLP051219453I002710888164422",
      "identifier": "M-Test0002",
      "loadingLocation":  { "id": "unece:LOCODE#FRLEH", "name": "Le Havre" },
      "unloadingLocation":{ "id": "unece:LOCODE#GBDVR", "name": "Dover" }
    }
  ]
}
```

🎉 Full DSP pull-mode data transfer complete.

---

## Troubleshooting

| Symptom | Step | Cause | Fix |
|---|---|---|---|
| `tenantProcessor.missingOrganizationId` | any non-login | Missing `?organization=<org-did>` | Add the query param (login uses `?x-api-key=` instead) |
| `tenantProcessor.apiKeyNotFound` | A1/B1 | api-key doesn't match a tenant (stale env after a re-bootstrap) | Re-read creds from the DB: `SELECT id, apiKey, organizationId FROM tenant` |
| `401 Unauthorized` on negotiation | C2 | Session JWT used where trust JWT is required | Use `cons_trust_jwt` in `Authorization` |
| Negotiation never reaches FINALIZED | C3 | Missing policy information sources | Add `TWIN_RIGHTS_MANAGEMENT_POLICY_INFORMATION_SOURCES="static,identity"` to `.env.local`, recreate container |
| `callerNotAuthorizedAsProvider` | C5 | Used `cons_trust_jwt` instead of `prov_trust_jwt` | Switch bearer; agreement's assigner is the provider |
| `pullTransfersNotSupported` | C5 | `dataPlanePath` not in the control-plane config | Set `TWIN_DATASPACE_DATA_PLANE_PATH` (the consumer-client extension forwards it) |
| `noArbiters` / `noProcessors` on C6 | C6 | Missing rights-management arbiter/processor env vars | Add the two `pass-through` env vars |
| `request.query.type undefined` on C6 | C6 | Missing query param | Append `&type=...` to the URL |
| `GuardError: guard.string` on `consumerPid` (C6) | C6 | Missing query param | Append `&consumerPid=...` to the URL |
| Negotiation TERMINATES at C3 | C2/C3 | Consumer-side state machine not bootstrapped — protocol architecture, not a config issue | Use the **C-poll** folder (or C-shortcut); see [../dsp-postman-walkthrough.md](../dsp-postman-walkthrough.md) |

---

## Shortcut: the automated consumer-client flow (Way 1)

The collection's **C-shortcut** is a two-call extension API that drives the whole negotiation, transfer, and fetch in-process. It needs `TWIN_DATASPACE_AUTO_START_TRANSFERS="true"` (the default in `.env.multitenant`) so the provider auto-starts the transfer.

```http
POST {{base}}/consumer-client/negotiate?organization={{cons_did}}
{ "datasetId": "{{dataset_id}}" }                                       -> { "agreementId": "..." }

POST {{base}}/consumer-client/query-data?organization={{cons_did}}
{ "agreementId": "{{agreement_id}}", "entityType": "{{dataset_type}}" } -> ItemList of Consignments
```

`C-shortcut-1` saves `agreement_id`; `C-shortcut-2` returns the data directly (no MySQL `SELECT`, no manual C5). For the manual provider-driven path (Way 2), set `TWIN_DATASPACE_AUTO_START_TRANSFERS="false"` (then `docker compose up -d`) and use the C-poll path (C2′–C6) below.

## C-poll — polling-only negotiation (rights-management ≥ `0.0.3-next.41`)

A separate folder, `C-poll`, demonstrates the polling-only variant unlocked by the `callbackAddress`-optional + always-advance-state change in `rights-management-pnp-service`. It drives the **negotiation phase** end-to-end from Postman — no `callbackAddress`, no MySQL `SELECT`, no consumer-client extension call.

Run order:

| # | Request | Effect |
|---|---|---|
| **C2′** | `POST /rights-management/negotiations/request` (no `callbackAddress`) | provider creates the entry, state → `REQUESTED`, auto-advances to `OFFERED` |
| **C3a′** | `GET /rights-management/negotiations/:id` | poll until `state: OFFERED`; offer is captured |
| **C3b′** | `POST /rights-management/negotiations/:id/events` (`event: ACCEPTED`) | consumer accepts the offer; state → `AGREED` |
| **C3c′** | `GET /rights-management/negotiations/:id` | poll until `state: AGREED`; `agreement_id` is captured |
| **C3d′** | `POST /rights-management/negotiations/:id/agreement/verification` | consumer verifies; state → `VERIFIED` → `FINALIZED` |
| **C3e′** | `GET /rights-management/negotiations/:id` | poll until `state: FINALIZED` |
| **C3f′** | `GET /rights-management/negotiations/admin/:id` (provider session) | fetch the agreement — the public GET is spec-minimal — auto-saves `agreement_id` |

**Verified on next.66:** no longer scoped to negotiation only — after C3f′ captures `agreement_id`, continue with C4 (include `callbackAddress` in the body — it is schema-required) → C5 → C6, all pure REST. The pull flow needs no consumer-side bootstrap; the `C-shortcut` is now just a convenience. See [../dsp-postman-walkthrough.md](../dsp-postman-walkthrough.md#polling-only-path-for-the-negotiation-phase-rights-management--003-next41) for the full architectural explanation.
