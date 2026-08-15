# app-air-cargo

**A verbatim extraction of an air-cargo app that was never wired to anything.**
Twenty files copied out of `etzhayyim/root` on 2026-07-20, carrying three
separate implementations of "air cargo" — an edge dispatcher, a SvelteKit BFF,
and a kotoba domain registry. **Only one of the three is in the deployed
bundle**, and every hostname any of them talks to is **NXDOMAIN**.

The code is not broken. The tests pass and they genuinely discriminate. What is
missing is everything the code points at.

Read this file before `MIGRATION-TODO.md`, which describes a remediation plan
for a deployment that does not exist.

## What is true now

Measured 2026-08-16. Every row is reproducible from
[`docs/operator-quickstart.md`](docs/operator-quickstart.md).

| What this repo asserts | What is true now |
|---|---|
| `wrangler.jsonc` serves `air-cargo.etzhayyim.com/*` and `a1rcarg0.etzhayyim.com/*` | Both are **NXDOMAIN** on 1.1.1.1, 8.8.8.8 and 9.9.9.9. The zone is healthy — `etzhayyim.com` apex answers `200` from Cloudflare NS — so these are missing labels, not an outage. |
| `src/app.ts` proxies to `dispatcher.etzhayyim.com` | **NXDOMAIN.** |
| `svelte/…/xrpc/[...path]/+server.ts` proxies to `mcp.etzhayyim.com` | **NXDOMAIN.** Both upstreams are gone, so no request path in this repo can complete even if it were deployed. |
| `kotodama.jsonld` declares the actor `did:web:air-cargo.etzhayyim.com` | Unresolvable. `did:web` resolution requires `https://air-cargo.etzhayyim.com/.well-known/did.json`; the host does not resolve. |
| `MIGRATION-TODO.md`: seed awaiting a Charter §2(a) codemod | The scan recorded in that same file found **none** of the patterns it was written to remove. The blocker was never the codemod. |
| `svelte/src/routes/+page.svelte` reports `routeCount: 0`, no routes, no vars | `wrangler.jsonc` in the same repo declares **2 routes and 8 vars**. The landing page is a generator artifact that never read the config next to it, and still names its own path as `60-apps/etzhayyim-project-air-cargo/…` — the location it was extracted out of. |
| Upstream `etzhayyim/root@main:60-apps/etzhayyim-project-air-cargo` | Gone. `60-apps` on `origin/main` now holds exactly one entry, `etzhayyim-project-organism`. |

## Three implementations, one deployed

`wrangler.jsonc` sets `main` to `svelte/.svelte-kit/cloudflare/_worker.js`. That
is the whole deploy. Building it and searching the **entire** resulting closure
(42 files — the `cloudflare/` output plus `output/server/**`, which `_worker.js`
imports across directory boundaries) finds:

| Implementation | Size | In the deployed bundle? |
|---|---|---|
| `svelte/` — SvelteKit BFF, forwards XRPC to the MCP router | 2.4 kB endpoint | **Yes.** All four probe symbols present. |
| `src/app.ts` — edge dispatcher, 8 methods, `/health` + `/_app/meta` | 76 lines | **No.** All nine probe symbols absent. |
| `kotoba/src/**` — the actual domain model (AT-record registry, E2E envelopes) | 625 lines | **No.** All five probe symbols absent. |

`kotoba/` is where the real work is — a plaintext/E2E split with shipment and
ULD anchors in the clear and AWB parties, claims and screening results sealed
via `encryptedWrite`. It is a library no deployed code imports.

## Four method vocabularies, none of which agree

| Source | Count | Names |
|---|---|---|
| `kotodama.jsonld` `capabilities` | 3 | `createCargoBooking`, `issueAirWaybill`, `acceptCargo` |
| `wrangler.jsonc` `APP_CAPABILITIES` | 3 | identical to the above |
| `src/app.ts` `methods` | 8 | adds `assignUld`, `trackShipment`, `processClaim`, `settleCargoAccount`, `reportCargoSecurity` |
| `kotoba/src/index.ts` exports | 11 | `registerShipment`, `getShipment`, `listShipments`, `listUldAssignments`, `getAwbParties`, `fileCargoClaim`, `coverage`, … |

Exactly **one** declared capability — `issueAirWaybill` — has an implementation.
`createCargoBooking` and `acceptCargo`, two of the three capabilities this actor
advertises to the network, **exist nowhere in the repository as code**. The
kotoba equivalent of "create a booking" is called `registerShipment`, and
nothing maps one name onto the other.

`settleCargoAccount` is advertised by `src/app.ts` but `kotoba/src/types.ts`
states it is deliberately *not* modelled here — IATA CASS fiat settlement stays
etzhayyim-side under consent-capability. That one is a documented exclusion, not
a gap.

## Provenance: intact, verified byte-for-byte

`migration.edn` declares the extraction, and all four claims hold (2026-08-16):

- declared tree `0c96f688…` **is** the real upstream tree for
  `60-apps/etzhayyim-project-air-cargo` at `0c30514a…`
- declared `:tracked-files 20` — actual 20
- declared `:bytes 48042` — actual 48042
- **20 of 20 blobs are byte-identical** to upstream (0 differ, 0 missing)

The only files beyond the upstream tree are the ones `:allowed-additions`
permits. The extraction was done correctly; what it extracted was already
disconnected. The source commit's own message is
`refactor(apps): extract nineteen-file band (#3256)`.

The two SDK dependencies (`@etzhayyim/sdk`, `@etzhayyim/sdk-mock`) are pinned to
commits that **still exist and are ancestors of their `main`** — the pins are
healthy, not dangling.

## The tests are real

`kotoba/test/air-cargo.test.ts` — **7 tests, 7 passing**, and they discriminate.
Three mutations, each caught by exactly the test that should catch it:

| Mutation | Result |
|---|---|
| remove the `shipmentExists` FK check in `assignUld` | 1 failed — `FK: uldAssignment requires an existing shipment` |
| make `isDecimalString` accept any string | 3 failed — shipment, AWB, and claim/screening suites |
| let `isUint` accept negatives | 1 failed — the shipment validation suite |

Restoring each returns 7/7. Running them takes a workaround on current npm; see
quickstart §4.

## What to do with it

An owner decision, not something a maintenance pass should take unilaterally:

1. **Retire it.** Nothing points at these hostnames, both upstreams are gone,
   and the deployed third of the repo only forwards to a dead router.
2. **Revive `kotoba/`.** It is the only part with tested domain logic, it has no
   runtime dependency on the dead hosts, and it is 625 lines. If air-cargo
   capability is wanted anywhere, this is the piece worth moving — not the two
   proxies.
3. **Leave it.** Costs nothing, but keeps a repo that reads as a live edge app
   to anyone who opens `src/app.ts` first — the one file guaranteed not to run.

Whichever is chosen, the capability declaration should stop advertising
`createCargoBooking` and `acceptCargo` until something implements them.
