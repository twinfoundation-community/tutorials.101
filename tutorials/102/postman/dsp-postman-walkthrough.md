# Tutorial 102 — DSP Pull-Mode Postman Walkthrough

> Created: 2026-06-11
> Last updated: 2026-06-24

> **⚠️ #203 update (organization identifiers, 2026-06-11).** This walkthrough and the collection in `postman/` have been migrated to the org-identifiers refactor (twin-node#19 / PR #203) and re-verified end-to-end via curl. What changed:
> - **Routing:** `x-api-key` works ONLY on `/authentication/login` (A1/B1). Every other request is tenant-routed by `?organization=<org-did>` — the collection now uses `{{prov_did}}` / `{{cons_did}}` there. Encrypted tenant tokens (`x-enc-tenant-token`, `prov_tenant_token`/`cons_tenant_token` env vars) are GONE.
> - **DIDs:** `prov_did` / `cons_did` are now each tenant's OWN organization DID (created via `tenant-create --organization-id`), no longer one shared node DID. Trust JWTs (A2/B2) are minted against these org DIDs and are identity-only (no `tid`/`org` claims).
> - **C1:** filter type is `FilterByMetadata` (was `FilterByExample`).
> - **C5:** `?organization={{prov_did}}` replaces the tenant token; the old "grab prov_tenant_token from the node log" hack is gone.
> - **C6:** `data_endpoint` arrives with `?organization=<provider-org-did>` baked by the catalogue/control-plane (cleartext — the encrypted-token URL-mangling pitfall is moot).
> - **C-shortcut:** now a **two-call** extension API: `POST /consumer-client/negotiate {datasetId}` returns `{agreementId}`, then `POST /consumer-client/query-data {agreementId, entityType}` returns the data. It runs end-to-end only when `TWIN_DATASPACE_AUTO_START_TRANSFERS="true"` (the default; the provider auto-starts so the extension's awaited `onStarted` callback fires). The old single-call `GET /query-data` + MySQL SELECT is superseded.
> - **Auto-start (2026-06-23):** the automated C-shortcut (Way 1) and this manual walkthrough (Way 2) need **opposite** `TWIN_DATASPACE_AUTO_START_TRANSFERS` values. Way 1 needs `"true"`; **this manual walkthrough needs `"false"`** so the provider does NOT auto-start and C5 `start` returns the data address synchronously. Flip it in `.env.multitenant` and `docker compose up -d` (no rebuild).
> - **Docker image:** as of 2026-06-29 docker-compose uses the **published** image `twinfoundation/twin-node:0.9.1-next.2` (bakes dataspace control+data-plane `0.9.1-next.4`, federated-catalogue / rights-management-pnp `0.9.1-next.2`, core `0.9.1-next.5`; verified inside the pulled image). The tutorial-side fixes are the single-node corrections in `apps/consumer-client` and `apps/dataspace-example-app`, plus (required on `0.9.1-next.x`) building the extensions with `./build-extensions.sh`, which builds both apps and strips their bundled `@twin.org/*` so they use the host image's packages; without that strip the node fails to start with `context ID "node" is missing`.
> - **C1 bearer:** the catalogue query uses the trust VC `{{cons_trust_jwt}}`, not the session JWT (the `#194` trust model). `trustHelper.trustVerifyFailed` means you sent the session JWT.


End-to-end guide for driving the full Dataspace Protocol pull-mode data transfer through the tutorial-102 node, using the Postman collection in `postman/`. The whole pull flow is Postman-drivable via the **C-poll** path; the **C-shortcut** is a one-call convenience (with an optional terminal `SELECT` for the pids). See [Why the callback-style C2/C3 aren't Postman-able](#why-c2c3c4-arent-100-postman-able) below for the architectural detail.

By the end you'll have:
- Provider and consumer trust JWTs
- A live ODRL agreement
- A `TransferStartMessage` with an access endpoint + bearer token
- An actual `GET /dataspace/entities` response returning two `Consignment` entities from the provider's data plane

---

## TL;DR

- **Setup, full flow C5–C6, fetching data**: all 100% Postman. ✅
- **The CALLBACK-based negotiation (C2/C3)**: still NOT possible from Postman — the consumer-side state machine must be bootstrapped in-process (architecture unchanged through next.66). ❌
- **Re-verified on next.66: the POLLING path makes the ENTIRE flow 100% Postman-able** — C2′ → C3a′–e′ → C3f′ (fetch agreement via provider admin route) → C4 (works given a real `agreement_id`; `callbackAddress` is schema-required in the body) → C5 → C6. ✅
- **The C-shortcut** is now a two-call extension API (`POST /consumer-client/negotiate` → `POST /consumer-client/query-data`) and needs `TWIN_DATASPACE_AUTO_START_TRANSFERS="true"`. This manual walkthrough (Way 2) instead needs it `"false"`.

This is the same architectural pattern as OAuth 2.0 — pure HTTP tools can complete pieces of the dance, but the consumer needs a real client app that holds session state and registers callbacks.

---

## Prerequisites

- `tutorials/102` node running: `cd tutorials/102 && ./build-extensions.sh && docker compose up -d` (`build-extensions.sh` builds both apps and strips their bundled `@twin.org/*`, required on `0.9.1-next.x`)
- `.env.local` has the two rights-management env vars set:
  ```sh
  TWIN_RIGHTS_MANAGEMENT_POLICY_ARBITERS="pass-through"
  TWIN_RIGHTS_MANAGEMENT_POLICY_ENFORCEMENT_PROCESSORS="pass-through"
  ```
- `.env.multitenant` has `TWIN_DATASPACE_DATA_PLANE_PATH="dataspace/entities"` (else C5 → `pullTransfersNotSupported`).
- `.env.multitenant` has **`TWIN_DATASPACE_AUTO_START_TRANSFERS="false"`** for this manual walkthrough, so the provider does not auto-start and C5 `start` returns the data address synchronously. (Leave it `"true"`, the default, only for the automated C-shortcut.) Change it and `docker compose up -d` to apply, no rebuild needed.
- Postman collection + environment imported from `tutorials/102/postman/`. See `postman/README.md` for the per-request reference.

---

## Adapting the environment for your own node

The Postman environment ships with values from a specific tutorial-102 setup. After importing on a different node (different bootstrap output, different tenant users, different api-keys), update these six environment variables before running anything. The rest stay as-is.

| Variable | Where to find your value |
|---|---|
| `prov_api_key` | From your bootstrap output. Each tenant has its own api-key. |
| `cons_api_key` | Same — the second tenant's api-key. |
| `prov_did` | The **provider tenant's** org DID. Read it straight from the tenant table: `docker exec mysql8_container mysql -utwin -ptwin twin -e "SELECT label, organizationId FROM tenant;"` — take the `organizationId` of the provider row. |
| `cons_did` | The **consumer tenant's** org DID — distinct from `prov_did` (per-tenant org DIDs since #203). Both come from `tenant-create --organization-id`. |
| `prov_email` / `cons_email` | The emails you assigned to the provider-tenant and consumer-tenant users during bootstrap. |
| `prov_password` / `cons_password` | The passwords you set for those users. |

These stay unchanged — they match the consumer-client extension's hardcoded references and the tutorial's app fixtures:

- `base`, `host_internal`
- `dataset_id`, `dataset_type`, `offer_id`, `app_id`

These are populated by the auto-extraction scripts as you run the flow — leave them empty at import time:

- `prov_session_jwt`, `cons_session_jwt`, `prov_trust_jwt`, `cons_trust_jwt`
- `negotiation_id`, `agreement_id` (reference flow only — not used by the shortcut)
- `consumer_pid`, `provider_pid`, `provider_pid_enc` (you paste these in after the MySQL SELECT during the C-shortcut step)
- `data_endpoint`, `access_token` (extracted from C5's response)

---

## The flow at a glance

| Step | Where | What it does |
|---|---|---|
| **A1–A4** | Postman | Login as provider, mint trust JWT, create offer, register dataset |
| **B1–B2** | Postman | Login as consumer, mint trust JWT |
| **C1** | Postman | Query the federated catalogue (proves the dataset is discoverable) |
| **C-shortcut** | Postman | `POST /consumer-client/negotiate` then `POST /consumer-client/query-data` (Way 1; needs auto-start `"true"`) |
| **C5** | Postman | `POST /transfers/:pid/start` — provider returns access endpoint + bearer token (Way 2; needs auto-start `"false"`) |
| **C6** | Postman | `GET /dataspace/entities` — actual data flowing from provider to consumer |

C2/C3 in the collection are kept for reference only — they show the correct callback-style DSP shape but fail with `negotiationNotFound` because they require consumer-side state that no REST endpoint can create (architecture unchanged through next.66). C4 DOES work from Postman when fed a real `agreement_id` — use the C-poll path below to obtain one. See [why](#why-c2c3c4-arent-100-postman-able).

A `C-poll` folder drives the **negotiation phase** end-to-end from Postman by omitting `callbackAddress` and polling the provider — requires `rights-management-pnp-service` >= `0.0.3-next.41`. See [Polling-only path for the negotiation phase](#polling-only-path-for-the-negotiation-phase-rights-management--003-next41) for what it does and does not unlock.

---

## What the auto-extraction scripts do

Most requests in the collection have a **Post-response script** (Scripts tab in Postman) that pulls a value out of the response and writes it to an environment variable so the next request can use it. Nothing magic — just `pm.environment.set(name, value)` calls. The table below is the complete map of what gets extracted, from where, and which downstream requests depend on it.

| Request | Extracts | From | Used by |
|---|---|---|---|
| **A1. Login as provider** | `prov_session_jwt` | `Set-Cookie` response header (`access_token=...`) | A2, A3, A4 |
| **A2. Mint provider trust JWT** | `prov_trust_jwt` | `response.jwt` | C5 |
| **A3. Create ODRL Offer** | (nothing) | — | — |
| **A4. Register Dataset** | (nothing) | — | — |
| **B1. Login as consumer** | `cons_session_jwt` | `Set-Cookie` response header | B2, C1 |
| **B2. Mint consumer trust JWT** | `cons_trust_jwt` | `response.jwt` | C2 (reference only; flow uses the shortcut) |
| **C1. Query federated catalogue** | `dataset_id`, `offer_id` (refreshed from catalogue) | `response.result.dataset[0]` | C2 (reference) |
| **C2. Initiate negotiation** | `negotiation_id` | `response.providerPid` | C3 |
| **C3. Poll until FINALIZED** | `agreement_id` (when state is FINALIZED) | `response.agreement["@id"]` | C4 |
| **C4. Request transfer** | `consumer_pid`, `provider_pid`, `provider_pid_enc` | pre-request UUID for consumer, `response.providerPid` for provider | C5 |
| **C-shortcut-1. Negotiate** | `agreement_id` | `response.agreementId` | C-shortcut-2 |
| **C-shortcut-2. Query data** | (nothing, returns the ItemList) | — | — |
| **C5. Start transfer** | `data_endpoint`, `access_token` | `response.dataAddress.endpoint` and `response.dataAddress.endpointProperties[name=="authorization"].value` | C6 |
| **C6. Fetch data** | (nothing — terminal step) | — | — |

A few things to know:

- **The "Variables in request" panel** that appears in Postman when you click a request only shows variables the request *uses* in headers / URL / body. It does NOT show variables a request *writes*. So C5's panel won't include `data_endpoint` / `access_token` even after C5 ran — those are outputs. To see what's actually populated, use the eye icon (top-right next to the env dropdown) to see all current values.

- **Scripts run only on successful responses** (200/201). If a request returns 4xx/5xx, the script still runs but the response shape might not have the expected fields — most scripts include a guard like `if (j.dataAddress) { ... }` so they don't crash, but they also don't populate anything.

- **The env writes are to "Current value"**, not "Initial value". Re-importing the environment JSON resets Current back to whatever's in the file (mostly empty strings), so you'll need to re-run the upstream requests after a re-import.

- **If a script silently fails to populate**, see [Tests scripts silently not firing after re-import](#pitfall-tests-scripts-silently-not-firing-after-re-import) in pitfalls — the universal fallback is to copy from the response body and paste into the env var Current value manually.

---

## Step-by-step

### A. Provider setup (one-time)

| # | Request | Saves into env |
|---|---|---|
| **A1. Login as provider** | `POST /authentication/login?x-api-key={{prov_api_key}}` with `{email, password}` | `prov_session_jwt` (from `Set-Cookie`) |
| **A2. Mint provider trust JWT** | `POST /identity/{{prov_did}}/verifiable-credential/trust-assertion` with `{subject:{id:{{prov_did}}}}` | `prov_trust_jwt` (from `response.jwt`) |
| **A3. Create ODRL Offer** *(skip if exists)* | `POST /rights-management/policy/admin` with the Offer body | — |
| **A4. Register Dataset** *(skip if exists)* | `POST /dataspace-control-plane/app-datasets` with the dataset body | — |

If A3 returns `"1"` or A4 returns `datasetAlreadyExists` — both fine, you already bootstrapped on a previous run. Move on.

### B. Consumer setup (one-time)

| # | Request | Saves into env |
|---|---|---|
| **B1. Login as consumer** | Same as A1 with `cons_api_key` / `cons_email` | `cons_session_jwt` |
| **B2. Mint consumer trust JWT** | Same as A2 with `cons_did` | `cons_trust_jwt` |

> 💡 **Watch for the env var being empty after B2.** The collection's Tests script writes to env, but if a script error swallows it, the var ends up `""`. After running B2, click the eye icon and confirm `cons_trust_jwt` starts with `eyJ...`. If empty, copy the `jwt` field from the response body and paste it into the env var manually (no quotes).

> 💡 **The two DIDs are DISTINCT (post-#203).** `prov_did` and `cons_did` are each tenant's own organization DID (created by `tenant-create --organization-id`), and they double as the tenant routing token on every non-login request. The old single-node "both equal the one node DID, routed by `x-api-key`" model is gone.

### C. Per-transfer flow

#### C1. Query the federated catalogue (Postman, optional)

```http
POST /federated-catalogue/request?organization={{cons_did}}
Authorization: Bearer {{cons_session_jwt}}

{
  "@context": ["https://w3id.org/dspace/2025/1/context.jsonld"],
  "@type": "CatalogRequestMessage",
  "filter": [
    { "@type": "FilterByMetadata", "dcterms:type": "{{dataset_type}}" }
  ]
}
```

Confirms the consumer can see the dataset in the catalogue. Returns a `Catalog` with the dataset and its policy. Not required for the transfer flow — useful for verification.

#### C2/C3/C4 — the shortcut

Instead of running C2 (initiate negotiation), C3 (poll for FINALIZED), C4 (request transfer) from Postman, the `consumer-client` extension exposes a **two-call** API that drives the whole negotiation + transfer + fetch in-process. This is **Way 1**, and it needs `TWIN_DATASPACE_AUTO_START_TRANSFERS="true"` (the default).

**Step 1 — `C-shortcut-1. Negotiate`:**

```http
POST /consumer-client/negotiate?organization={{cons_did}}
{ "datasetId": "{{dataset_id}}" }
```

Expect `200 OK` with `{ "agreementId": "..." }`; the test script saves it to `agreement_id`. The extension ran the entire DSP negotiation (request, offer, accept, agree, verify, finalize) in-process.

**Step 2 — `C-shortcut-2. Query data`:**

```http
POST /consumer-client/query-data?organization={{cons_did}}
{ "agreementId": "{{agreement_id}}", "entityType": "{{dataset_type}}" }
```

Expect `200 OK` with an `ItemList` of two `Consignment` entities. The extension requested the transfer, waited for the provider to auto-start it, and fetched the data-plane channel, all in-process. No MySQL `SELECT` and no manual C5 are needed.

> **Why this works:** the `consumer-client` extension is a custom REST surface that internally calls `dataspaceControlPlane.negotiateAgreement(...)` then `prepareTransfer(...)`, in-process methods that bootstrap consumer-side state (negotiation + transfer-process rows, registered callbacks) before talking to the provider over HTTP. `negotiate` resolves when the negotiation FINALIZES; `query-data` resolves when the auto-started transfer reaches STARTED and the data is fetched.

> **Why it needs auto-start:** `query-data` passively waits for the in-process `onStarted` callback, so the provider must auto-start the transfer (`TWIN_DATASPACE_AUTO_START_TRANSFERS="true"`). The manual C5 path (Way 2) needs the opposite value; see the auto-start note at the top.

> **Why you couldn't do the callback-style C2/C3 from Postman alone:** see [the section below](#why-c2c3c4-arent-100-postman-able).

#### C5. Start the transfer (Postman)

```http
POST /dataspace-control-plane/transfers/{{provider_pid_enc}}/start?organization={{prov_did}}
Authorization: Bearer {{prov_trust_jwt}}     ← ⚠️ PROVIDER trust JWT, not consumer's; routing is ?organization={{prov_did}} (not x-api-key)

{
  "@context": ["https://w3id.org/dspace/2025/1/context.jsonld"],
  "@type": "TransferStartMessage",
  "consumerPid": "{{consumer_pid}}",
  "providerPid": "{{provider_pid}}"
}
```

Response is a `TransferStartMessage` with `dataAddress.endpoint` and an `authorization` property in `endpointProperties`. The collection's Tests script auto-saves both to env (`data_endpoint`, `access_token`).

> 💡 **If `data_endpoint` or `access_token` shows red/empty in C6**, the Tests script didn't fire (Postman re-import quirk — see [pitfalls](#pitfall-tests-scripts-silently-not-firing-after-re-import)). Manually copy from C5's response body and paste into the env var **Current value** column:
> - `data_endpoint` ← `response.dataAddress.endpoint` (the full URL with `?organization=<provider-org-did>`)
> - `access_token` ← `response.dataAddress.endpointProperties[name=="authorization"].value` (the long `eyJ...` JWT)
>
> No quotes. Save. Re-run C6.

> **Why the PROVIDER's trust JWT here:** the agreement's `assigner` is the provider. The `startTransfer` route's authorization check uses `buildCallerComposite(trustInfo)` and verifies the caller matches the assigner. Using the consumer's trust JWT here fails with `callerNotAuthorizedAsProvider`.

#### C6. Fetch the data (Postman)

In Postman, open C6. The URL bar should be exactly:

```
{{data_endpoint}}&consumerPid={{consumer_pid}}&type={{dataset_type}}
```

⚠️ **Params tab must be empty.** Do NOT specify `consumerPid` or `type` in the structured params — only in the raw URL. (See [URL mangling pitfall](#pitfall-postmans-structured-url-mangles-encrypted-tokens) below.)

```http
GET {{data_endpoint}}&consumerPid={{consumer_pid}}&type={{dataset_type}}
Authorization: Bearer {{access_token}}    ← from C5's dataAddress, NOT a session JWT
```

Expect HTTP 200 with a `schema.org` `ItemList` containing two `Consignment` entities (Rotterdam → Felixstowe and Le Havre → Dover, per the seed data in `dataspace-example-app`).

🎉 **End-to-end flow complete.**

---

## Why C2/C3/C4 aren't 100% Postman-able

Short answer: **DSP is a stateful two-party conversation, and one of the parties has to be bootstrapped from inside the platform.**

### The protocol shape

The Dataspace Protocol (DSP, eclipse-dataspace-protocol-base) is designed for two independent control planes — a consumer's and a provider's — to negotiate a contract and execute a transfer. Each side maintains its own state machine for each negotiation/transfer, and they exchange messages over HTTP to advance each other's state.

```
Consumer Control Plane                Provider Control Plane
    [state: REQUESTED]   ---- ContractRequestMessage ---->   [state: REQUESTED]
                                                                    │
                                                                    │ pass-through
                                                                    │ negotiator
                                                                    ▼
    [state: OFFERED]     <---- ContractOfferMessage  ----     [state: OFFERED]
    │
    │ if callback handler accepts
    ▼
    [state: ACCEPTED]    ---- ContractAcceptanceMsg ----->    [state: ACCEPTED]
                                                                    │
                                                                    │ ...continues...
                                                                    ▼
    [state: FINALIZED]   <---- ContractAgreementMsg ----      [state: FINALIZED]
```

Look at the **arrows pointing into the consumer** — `ContractOfferMessage`, `ContractAgreementMessage`. The provider POSTs those to a `callbackAddress` URL the consumer supplied. When they arrive, the consumer's PNP service does:

```ts
// rights-management-pnp-service: offerFromProvider handler
const policyNegotiation = await this._pnap.get(consumerPid);
//                                            ↑
// "Find the local negotiation record keyed by this consumerPid"
// If not found → setErrorState("negotiationNotFound") → TERMINATED
```

The protocol assumes the consumer ALREADY HAS a local negotiation record matching that `consumerPid`. **The record was supposed to be created BEFORE the consumer sent its initial `ContractRequestMessage` to the provider.**

### The in-process-only bootstrap

The platform has exactly one way to create this record: by calling `dataspaceControlPlane.negotiateAgreement(...)` — an in-process method on the consumer's local DSP control plane. What it does:

```ts
async negotiateAgreement(datasetId, policyId, providerEndpoint, consumerEndpoint, params) {
  // 1. Create the consumer-side record in `policy-negotiation` table
  const negotiation = await this._pnap.create({ consumerPid, state: REQUESTED, ... });

  // 2. Register in-process callbacks for state changes
  this._dataspaceControlPlane.registerNegotiationCallback(callbackId, {
    onStateChanged: async (id, state, data) => { /* ... */ },
    onCompleted:    async (id, agreementId) => { /* ... */ },
    onFailed:       async (id, reason) => { /* ... */ },
  });

  // 3. Send ContractRequestMessage to provider over HTTP
  await this._pnpRestClient.requestFromConsumer(message, trustPayload);

  // 4. (Eventually) provider's callback arrives, finds the record, advances state,
  //    fires `onCompleted(agreementId)` when FINALIZED — the awaiter resumes.
  return new Promise(resolve => { /* resolved by callback */ });
}
```

**Step 2 is the architectural reason no REST equivalent exists** — `onStateChanged`, `onCompleted`, `onFailed` are JavaScript function references. You can't serialize a function over HTTP. There's no way to "register an in-process callback" via a REST call.

### What our manual C2/C3/C4 attempts in Postman actually did

- **C2** sent a `ContractRequestMessage` directly to `/rights-management/negotiations/request`. This works on the provider side — they create their record. But our consumer side has nothing.
- **Provider's pass-through negotiator** accepts the offer and tries to POST a `ContractOfferMessage` to our `callbackAddress` at `/rights-management/negotiations/{consumerPid}/offers`.
- **Consumer's PNP** receives this, calls `pnap.get(consumerPid)` → NotFoundError → `setErrorState("negotiationNotFound")` → negotiation TERMINATES.
- **C3** polls and sees `state: TERMINATED`.

C4 has the same problem one level deeper — `requestTransfer` expects the consumer-side `transfer-process` row to exist (similar to how negotiation expects its own row). No REST endpoint creates it.

This is the **same architectural gap** documented as ["Missing platform feature: consumer-side transfer entry auto-creation"](consumer-client-loop-investigation.md#missing-feature-transfer-entry-auto-creation) — except it shows up at both the negotiation AND the transfer layer.

### Polling-only path for the negotiation phase (rights-management ≥ `0.0.3-next.41`)

A platform change to `rights-management-pnp-service` decouples negotiation state advancement from the HTTP callback push. Before the change, the provider's PNP only moved state forward when a callback URL was supplied; without one, the state machine silently stalled at `REQUESTED`. After the change, state advances on the provider side regardless, and the callback push is best-effort.

What that unlocks for tutorials/102: **the negotiation phase is now Postman-drivable end-to-end** by omitting `callbackAddress` and polling the provider for state instead of waiting for a push.

```
Consumer (Postman)                           Provider PNP (local)
    POST /negotiations/request               [state: REQUESTED]
    (no callbackAddress)                            │
                                                    │ pass-through negotiator
                                                    ▼
                                             [state: OFFERED + offer]
    GET  /negotiations/:id          <─── (poll) ─── (no callback fires)
    POST /negotiations/:id/events
         (event: ACCEPTED)               ───>
                                             [state: AGREED + agreement]
    GET  /negotiations/:id          <─── (poll)
    POST /negotiations/:id/agreement/verification ─>
                                             [state: VERIFIED]
                                                    │
                                                    ▼
                                             [state: FINALIZED]
    GET  /negotiations/:id          <─── (poll)
```

Because no callback is ever sent to the consumer, the consumer-side `pnap.get(consumerPid)` lookup (the original `negotiationNotFound` blocker above) is never exercised. The provider's PNP holds the full state and the consumer drives the protocol events via REST.

**Scope (verified end-to-end on next.66).** The polling path now covers the **full pull flow**, not just negotiation: the public `GET /negotiations/:id` is DSP-spec-minimal (pids + state, no agreement), so fetch the agreement via the provider **admin** route (`C3f′` in the collection, auto-saves `agreement_id`), then `C4` (include `callbackAddress` — schema-required) returns `TransferProcess REQUESTED`, and `C5`/`C6` complete on that transfer. No consumer-side bootstrap is needed for pulls — the earlier claim that the transfer layer required it is outdated.

A `C-poll` request folder in the Postman collection demonstrates this variant — see `postman/README.md` for the request order.

### The workaround: a custom REST extension

The `consumer-client` extension in this tutorial does exactly what a real DSP client app would do:

```ts
// tutorials/102/consumer-client/src/consumerClient.ts
public async getData(): Promise<unknown> {
  // ... federated catalogue lookup ...

  const callbackId = `negotiation-${new Date().toISOString()}`;
  this._dataspaceControlPlane.registerNegotiationCallback(callbackId, {
    onCompleted: async (negotiationId, agreementId) => {
      // negotiation done — kick off requestTransfer
      const result = await this._providerControlPlane.requestTransfer({
        agreementId, consumerPid, format: HttpProxyPull, ...
      }, token);
      // save resulting transfer-process row into local storage
      await this._transferProcessStorage.set({
        consumerPid, providerPid: result.providerPid,
        state: REQUESTED, agreementId, ...
      });
    },
    onFailed: (id, reason) => { /* ... */ }
  });

  // Kick off negotiation
  await this._dataspaceControlPlane.negotiateAgreement(
    datasetId, policyId, providerEndpoint, this._CONSUMER_ENDPOINT, {}
  );
}
```

It registers in-process callbacks, calls the in-process `negotiateAgreement`, then in the `onCompleted` callback calls `requestTransfer` and stores the result. By the time `getData()` returns, MySQL has the row we need.

The extension exposes this whole thing as a small two-call REST API (`POST /consumer-client/negotiate` then `POST /consumer-client/query-data`), which is what makes it usable from Postman. **The extension is the "client app" that the protocol assumes you have.**

### Real cross-node deployments

In production, each party would run its own TWIN node (its own consumer-client, its own dataspace control plane). The cross-tenant in-process callbacks become genuine cross-node HTTP callbacks (the consumer's node hosts the PNP callback endpoint with its own state machine). The protocol works exactly as designed.

The thing you can't do — from any party, in any deployment — is **drive a consumer-side flow purely via REST from outside the consumer's own node**. The consumer's node is always the one doing the in-process orchestration.

---

## Pitfalls

### Empty `cons_trust_jwt` after B2

The B2 Tests script writes `pm.environment.set('cons_trust_jwt', j.jwt)`. If anything in the test script throws above that line, the set never runs but B2 visually looks OK. Verify with the eye icon. If empty: copy the `jwt` value from B2's response body (without quotes) and paste into the Current value column of the env var.

<a id="pitfall-tests-scripts-silently-not-firing-after-re-import"></a>
### Tests scripts silently not firing after re-import

Symptom: request returns the expected response, but env vars that should auto-populate (`prov_trust_jwt`, `cons_trust_jwt`, `data_endpoint`, `access_token`, `negotiation_id`, `agreement_id`, `provider_pid`) stay empty / show red in downstream requests.

Likely causes (in order of frequency):

1. **Re-import preserved old script content.** If you had the collection imported before and re-import the new JSON, Postman sometimes keeps the OLD request's Scripts tab content. Delete the old collection entirely BEFORE importing the new file.
2. **No environment selected.** `pm.environment.set` writes to the active environment. If the top-right dropdown shows "No environment", the set is a no-op. Pick the env, re-run the request.
3. **Script throws silently.** Open Postman Console (`View → Show Postman Console` / `Cmd+Opt+C`), re-run the request, look for red error lines. A typo or wrong response-shape assumption aborts the rest of the script.
4. **Postman didn't refresh the env view.** Sometimes the env panel doesn't update immediately after `set`. Click another env var and back to force refresh.

**Universal fallback when you don't want to debug:** the response body has all the values. Open the env (eye icon → Edit), Current value column, paste the value from the response. Save. Continue. The collection's auto-extraction is convenience, not requirement.

### `documentNotFound` on B2

Means the DID in `cons_did` has no DID document / trust-assertion verification method registered. `cons_did` must be the **consumer tenant's** org DID (from `tenant-create --organization-id`), and that DID needs its `trust-assertion` VM added (`identity-verification-method-create … --verification-method-id=trust-assertion`, part of the per-tenant setup in §3 of the migration doc).

### `callerNotAuthorizedAsProvider` on C5

You used `cons_trust_jwt` instead of `prov_trust_jwt`. The agreement's `assigner` is the provider — `startTransfer`'s authz check requires a provider-signed bearer.

### `pullTransfersNotSupported` on C5

The dataspace control plane service didn't get `dataPlanePath` in its config — set `TWIN_DATASPACE_DATA_PLANE_PATH="dataspace/entities"` in `.env.multitenant` (the consumer-client extension's `extension.ts` forwards it into the control-plane config).

### `noArbiters` / `noProcessors` on C6

Missing `TWIN_RIGHTS_MANAGEMENT_POLICY_ARBITERS` and/or `TWIN_RIGHTS_MANAGEMENT_POLICY_ENFORCEMENT_PROCESSORS` in `.env.local`. Set both to `"pass-through"` and recreate the container.

<a id="pitfall-postmans-structured-url-mangles-encrypted-tokens"></a>
### C6 returns the wrong thing / empty after import-then-edit

Keep the C6 URL as ONE raw string — leave the Params tab empty:

- In C6, Params tab: remove `consumerPid` and `type` entirely.
- URL bar: paste exactly `{{data_endpoint}}&consumerPid={{consumer_pid}}&type={{dataset_type}}` — no structured query params, only the raw string.

Postman's structured `query` array can re-parse a pre-built query string (`data_endpoint` already carries `?organization=<did>`) and silently move things around. Post-#203 the org DID is cleartext so there's no encryption to corrupt, but keeping it all in the raw URL still avoids the re-parse surprise.

### `state=TERMINATED` immediately on C3

The negotiation was rejected. Two common causes:
- The callback POST from provider to consumer 404'd (you used `/dataspace-control-plane` as `callbackAddress` instead of `/rights-management` — but even fixing this won't help, because of the bootstrap gap above; use the shortcut)
- Missing PIP/arbiter env vars

---

## Glossary

| Term | Meaning |
|---|---|
| **DSP** | Dataspace Protocol (Eclipse spec) — defines the message envelopes for cross-organization data sharing |
| **DCAT** | Data Catalogue Vocabulary — the W3C standard for describing datasets |
| **ODRL** | Open Digital Rights Language — the W3C standard for policy expression |
| **PNP** | Policy Negotiation Point — service that handles contract negotiation |
| **PNAP** | Policy Negotiation Administration Point — storage/admin for negotiations |
| **PAP** | Policy Administration Point — manages ODRL policies, agreements, offers |
| **PDP** | Policy Decision Point — evaluates "is this action permitted under this agreement?" |
| **PEP** | Policy Enforcement Point — gates data access based on PDP decisions |
| **PIP** | Policy Information Point — provides contextual data to the PDP |
| **VC** / **JWT-VC** | Verifiable Credential — JWT-formatted assertion signed by an identity's DID; used as trust tokens |
| **DID** | Decentralized Identifier — cryptographic identity (e.g. `did:entity-storage:0x...`) |
| **consumerPid / providerPid** | Each party's local identifier for the same negotiation/transfer; cross-referenced in DSP messages |
| **callbackAddress** | URL on the consumer that the provider POSTs state updates back to |

---

## See also

- [postman/README.md](postman/README.md) — per-request reference for the collection
- [consumer-client-loop-investigation.md](consumer-client-loop-investigation.md) — root-cause investigation and platform bugs surfaced during this work
- [Eclipse DSP spec](https://eclipse-dataspace-protocol-base.github.io/DataspaceProtocol/2025-1-err1/) — the protocol this tutorial implements
