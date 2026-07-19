/**
 * air-cargo kotoba — kotoba-E2E registry.
 *
 * Plaintext path (shipment, uldAssignment): sdk.write / sdk.read — operational
 * logistics anchors. FK uldAssignment → shipment via exists() (read + check).
 * E2E path (awbParties, cargoClaim, securityScreening): sdk.encryptedWrite /
 * sdk.encryptedRead — PII/CUI/LE bodies sealed in the kotoba envelope
 * (ADR-2605181100), read-cap = owner DID + explicit recipients. The substrate
 * never sees party identities, claim amounts, or screening results in plaintext.
 *
 * CASS fiat settlement EXECUTION stays etzhayyim (consent-capability) — not modeled
 * here as a collection.
 */

import type { Etzhayyim } from "@etzhayyim/sdk";
import {
  AWB_PARTIES_INNER_TYPE,
  CARGO_CLAIM_INNER_TYPE,
  SECURITY_SCREENING_INNER_TYPE,
  SHIPMENT_COLLECTION,
  ULD_ASSIGNMENT_COLLECTION,
  isDecimalString,
  isUint,
  rkeyOf,
  shipmentDidFor,
  uldDidFor,
  type AssignUldInput,
  type AssignUldOutput,
  type AwbPartiesBody,
  type AwbPartiesView,
  type CargoClaimBody,
  type CargoClaimView,
  type CoverageInput,
  type CoverageOutput,
  type FileClaimInput,
  type FileClaimOutput,
  type GetAwbPartiesInput,
  type GetAwbPartiesOutput,
  type GetShipmentInput,
  type GetShipmentOutput,
  type IssueAwbInput,
  type IssueAwbOutput,
  type ListShipmentsInput,
  type ListShipmentsOutput,
  type ListUldAssignmentsInput,
  type ListUldAssignmentsOutput,
  type RegisterShipmentInput,
  type RegisterShipmentOutput,
  type ReportSecurityInput,
  type ReportSecurityOutput,
  type SecurityScreeningBody,
  type SecurityScreeningView,
  type ShipmentRecord,
  type ShipmentView,
  type TrackShipmentInput,
  type TrackShipmentOutput,
  type UldAssignmentRecord,
  type UldAssignmentView,
} from "./types.js";

const PAGE_LIMIT = 100;
const DEFAULT_MAX_SCAN = 10_000;

// ─── Plaintext FK helper (exists via read; mock has no exists()) ─────

async function shipmentExists(e: Etzhayyim, awbNo: string): Promise<boolean> {
  const rkey = rkeyOf("ship", awbNo);
  const resp = await e
    .read<ShipmentRecord>({ collection: SHIPMENT_COLLECTION, rkey })
    .catch(() => ({ records: [] as Array<{ uri: string; value: ShipmentRecord }> }));
  return Boolean(resp.records[0]?.value);
}

// ─── Shipment anchor (PLAINTEXT) ────────────────────────────────────

export async function registerShipment(e: Etzhayyim, input: RegisterShipmentInput): Promise<RegisterShipmentOutput> {
  if (!input.awbNo || !input.origin || !input.dest) return { status: "rejected", error: "missingRequiredFields" };
  if (input.pieces !== undefined && !isUint(input.pieces)) return { status: "rejected", error: "invalidPieces" };
  if (input.grossWeightKg !== undefined && !isDecimalString(input.grossWeightKg)) return { status: "rejected", error: "invalidGrossWeightKg" };
  const rkey = rkeyOf("ship", input.awbNo);
  const existing = await e.read<ShipmentRecord>({ collection: SHIPMENT_COLLECTION, rkey }).catch(() => ({ records: [] }));
  if (existing.records[0]?.value) {
    return { status: "alreadyExists", shipmentUri: existing.records[0].uri, did: existing.records[0].value.did, awbNo: input.awbNo };
  }
  const now = new Date().toISOString();
  const did = shipmentDidFor(input.awbNo);
  const record: ShipmentRecord = {
    did,
    awbNo: input.awbNo,
    origin: input.origin,
    dest: input.dest,
    commodity: input.commodity,
    grossWeightKg: input.grossWeightKg,
    pieces: input.pieces,
    status: input.status ?? "booked",
    location: input.location,
    createdAt: now,
  };
  const receipt = await e.write({ collection: SHIPMENT_COLLECTION, record: record as unknown as Record<string, unknown>, rkey });
  return { status: "registered", shipmentUri: receipt.uri, did, awbNo: input.awbNo };
}

export async function trackShipment(e: Etzhayyim, input: TrackShipmentInput): Promise<TrackShipmentOutput> {
  if (!input.awbNo || !input.status) return { status: "rejected", error: "missingRequiredFields" };
  const rkey = rkeyOf("ship", input.awbNo);
  const existing = await e.read<ShipmentRecord>({ collection: SHIPMENT_COLLECTION, rkey }).catch(() => ({ records: [] }));
  const prior = existing.records[0]?.value;
  if (!prior) return { status: "rejected", error: "shipmentNotFound" };
  const updated: ShipmentRecord = { ...prior, status: input.status, location: input.location ?? prior.location };
  const receipt = await e.write({ collection: SHIPMENT_COLLECTION, record: updated as unknown as Record<string, unknown>, rkey });
  return { status: "updated", shipmentUri: receipt.uri, awbNo: input.awbNo };
}

export async function getShipment(e: Etzhayyim, input: GetShipmentInput): Promise<GetShipmentOutput> {
  if (!input.awbNo) return { error: "invalidAwbNo" };
  const rkey = rkeyOf("ship", input.awbNo);
  const resp = await e.read<ShipmentRecord>({ collection: SHIPMENT_COLLECTION, rkey }).catch(() => ({ records: [] }));
  const r = resp.records[0];
  if (!r?.value) return { error: "notFound" };
  return { shipment: { ...r.value, shipmentUri: r.uri } };
}

export async function listShipments(e: Etzhayyim, input: ListShipmentsInput = {}): Promise<ListShipmentsOutput> {
  const limit = Math.min(input.limit ?? 50, 200);
  const resp = await e.read<ShipmentRecord>({ collection: SHIPMENT_COLLECTION, cursor: input.cursor, limit });
  const items: ShipmentView[] = resp.records
    .filter((r) => (!input.dest || r.value.dest === input.dest) && (!input.status || r.value.status === input.status))
    .map((r) => ({ ...r.value, shipmentUri: r.uri }));
  return { items, cursor: resp.cursor, total: items.length };
}

// ─── ULD assignment (PLAINTEXT, FK → shipment) ──────────────────────

export async function assignUld(e: Etzhayyim, input: AssignUldInput): Promise<AssignUldOutput> {
  if (!input.awbNo || !input.uldNo || !input.flightNo) return { status: "rejected", error: "missingRequiredFields" };
  if (!(await shipmentExists(e, input.awbNo))) return { status: "rejected", error: "shipmentNotFound" };
  const rkey = rkeyOf("uld", `${input.awbNo}-${input.uldNo}`);
  const existing = await e.read<UldAssignmentRecord>({ collection: ULD_ASSIGNMENT_COLLECTION, rkey }).catch(() => ({ records: [] }));
  if (existing.records[0]?.value) {
    return { status: "alreadyExists", assignmentUri: existing.records[0].uri, did: existing.records[0].value.did };
  }
  const now = new Date().toISOString();
  const did = uldDidFor(input.awbNo, input.uldNo);
  const record: UldAssignmentRecord = {
    did,
    awbNo: input.awbNo,
    uldNo: input.uldNo,
    uldType: input.uldType,
    flightNo: input.flightNo,
    depDate: input.depDate,
    createdAt: now,
  };
  const receipt = await e.write({ collection: ULD_ASSIGNMENT_COLLECTION, record: record as unknown as Record<string, unknown>, rkey });
  return { status: "assigned", assignmentUri: receipt.uri, did };
}

export async function listUldAssignments(e: Etzhayyim, input: ListUldAssignmentsInput = {}): Promise<ListUldAssignmentsOutput> {
  const limit = Math.min(input.limit ?? 50, 200);
  const resp = await e.read<UldAssignmentRecord>({ collection: ULD_ASSIGNMENT_COLLECTION, cursor: input.cursor, limit });
  const items: UldAssignmentView[] = resp.records
    .filter((r) => (!input.awbNo || r.value.awbNo === input.awbNo) && (!input.flightNo || r.value.flightNo === input.flightNo))
    .map((r) => ({ ...r.value, assignmentUri: r.uri }));
  return { items, cursor: resp.cursor, total: items.length };
}

// ─── AWB parties (E2E-ENCRYPTED, PII/CUI) ───────────────────────────

export async function issueAirWaybill(e: Etzhayyim, input: IssueAwbInput): Promise<IssueAwbOutput> {
  if (!input.awbNo || !input.shipperName || !input.consigneeName) return { status: "rejected", error: "missingRequiredFields" };
  if (input.pieces !== undefined && !isUint(input.pieces)) return { status: "rejected", error: "invalidPieces" };
  if (input.grossWeightKg !== undefined && !isDecimalString(input.grossWeightKg)) return { status: "rejected", error: "invalidGrossWeightKg" };
  const body: AwbPartiesBody = {
    awbNo: input.awbNo,
    shipperName: input.shipperName,
    consigneeName: input.consigneeName,
    shipperDid: input.shipperDid,
    consigneeDid: input.consigneeDid,
    commodity: input.commodity,
    pieces: input.pieces,
    grossWeightKg: input.grossWeightKg,
  };
  const receipt = await e.encryptedWrite<Record<string, unknown>>({
    innerType: AWB_PARTIES_INNER_TYPE,
    record: body as unknown as Record<string, unknown>,
    recipients: input.recipients ?? [],
    rkey: rkeyOf("awb", input.awbNo),
  });
  return { status: "issued", uri: receipt.uri, keyId: receipt.keyId, awbNo: input.awbNo };
}

async function scanAwbParties(e: Etzhayyim, maxScan: number): Promise<AwbPartiesView[]> {
  const out: AwbPartiesView[] = [];
  let cursor: string | undefined;
  while (out.length < maxScan) {
    const page = await e.encryptedRead<AwbPartiesBody>({ innerType: AWB_PARTIES_INNER_TYPE, cursor, limit: PAGE_LIMIT });
    for (const r of page.records) out.push({ ...r.value, uri: r.uri, sender: r.sender, createdAt: r.createdAt });
    if (!page.cursor || page.records.length === 0) break;
    cursor = page.cursor;
  }
  return out;
}

export async function getAwbParties(e: Etzhayyim, input: GetAwbPartiesInput): Promise<GetAwbPartiesOutput> {
  if (!input.awbNo) return { error: "invalidAwbNo" };
  const all = await scanAwbParties(e, DEFAULT_MAX_SCAN);
  const found = all.find((p) => p.awbNo === input.awbNo);
  if (!found) return { error: "notFound" };
  return { parties: found };
}

// ─── Cargo claim (E2E-ENCRYPTED, confidential financial) ────────────

export async function fileCargoClaim(e: Etzhayyim, input: FileClaimInput): Promise<FileClaimOutput> {
  if (!input.claimId || !input.awbNo || !input.claimType) return { status: "rejected", error: "missingRequiredFields" };
  if (!isDecimalString(input.claimAmount)) return { status: "rejected", error: "invalidClaimAmount" };
  const body: CargoClaimBody = {
    claimId: input.claimId,
    awbNo: input.awbNo,
    claimType: input.claimType,
    claimAmount: input.claimAmount,
    currency: input.currency,
    filedAt: new Date().toISOString(),
  };
  const receipt = await e.encryptedWrite<Record<string, unknown>>({
    innerType: CARGO_CLAIM_INNER_TYPE,
    record: body as unknown as Record<string, unknown>,
    recipients: input.recipients ?? [],
    rkey: rkeyOf("claim", input.claimId),
  });
  return { status: "filed", uri: receipt.uri, keyId: receipt.keyId, claimId: input.claimId };
}

async function scanCargoClaims(e: Etzhayyim, maxScan: number): Promise<CargoClaimView[]> {
  const out: CargoClaimView[] = [];
  let cursor: string | undefined;
  while (out.length < maxScan) {
    const page = await e.encryptedRead<CargoClaimBody>({ innerType: CARGO_CLAIM_INNER_TYPE, cursor, limit: PAGE_LIMIT });
    for (const r of page.records) out.push({ ...r.value, uri: r.uri, sender: r.sender, createdAt: r.createdAt });
    if (!page.cursor || page.records.length === 0) break;
    cursor = page.cursor;
  }
  return out;
}

// ─── Security screening (E2E-ENCRYPTED, LE result + PII) ────────────

export async function reportCargoSecurity(e: Etzhayyim, input: ReportSecurityInput): Promise<ReportSecurityOutput> {
  if (!input.screeningId || !input.awbNo || !input.securityCheckType || !input.result) return { status: "rejected", error: "missingRequiredFields" };
  const body: SecurityScreeningBody = {
    screeningId: input.screeningId,
    awbNo: input.awbNo,
    securityCheckType: input.securityCheckType,
    result: input.result,
    screenerId: input.screenerId,
    screenedAt: new Date().toISOString(),
  };
  const receipt = await e.encryptedWrite<Record<string, unknown>>({
    innerType: SECURITY_SCREENING_INNER_TYPE,
    record: body as unknown as Record<string, unknown>,
    recipients: input.recipients ?? [],
    rkey: rkeyOf("sec", input.screeningId),
  });
  return { status: "reported", uri: receipt.uri, keyId: receipt.keyId, screeningId: input.screeningId };
}

async function scanSecurityScreenings(e: Etzhayyim, maxScan: number): Promise<SecurityScreeningView[]> {
  const out: SecurityScreeningView[] = [];
  let cursor: string | undefined;
  while (out.length < maxScan) {
    const page = await e.encryptedRead<SecurityScreeningBody>({ innerType: SECURITY_SCREENING_INNER_TYPE, cursor, limit: PAGE_LIMIT });
    for (const r of page.records) out.push({ ...r.value, uri: r.uri, sender: r.sender, createdAt: r.createdAt });
    if (!page.cursor || page.records.length === 0) break;
    cursor = page.cursor;
  }
  return out;
}

// ─── Coverage rollup (plaintext + E2E countAll) ─────────────────────

export async function coverage(e: Etzhayyim, input: CoverageInput = {}): Promise<CoverageOutput> {
  const maxScan = Math.min(input.maxScan ?? DEFAULT_MAX_SCAN, DEFAULT_MAX_SCAN);
  const shipmentsByDest: Record<string, number> = {};
  let shipmentCount = 0;
  let shipCursor: string | undefined;
  while (shipmentCount < maxScan) {
    const page = await e.read<ShipmentRecord>({ collection: SHIPMENT_COLLECTION, cursor: shipCursor, limit: PAGE_LIMIT });
    for (const r of page.records) {
      shipmentsByDest[r.value.dest] = (shipmentsByDest[r.value.dest] ?? 0) + 1;
      shipmentCount += 1;
    }
    if (!page.cursor || page.records.length < PAGE_LIMIT) break;
    shipCursor = page.cursor;
  }
  let uldAssignmentCount = 0;
  let uldCursor: string | undefined;
  while (uldAssignmentCount < maxScan) {
    const page = await e.read<UldAssignmentRecord>({ collection: ULD_ASSIGNMENT_COLLECTION, cursor: uldCursor, limit: PAGE_LIMIT });
    uldAssignmentCount += page.records.length;
    if (!page.cursor || page.records.length < PAGE_LIMIT) break;
    uldCursor = page.cursor;
  }
  const awbPartiesCount = (await scanAwbParties(e, maxScan)).length;
  const cargoClaimCount = (await scanCargoClaims(e, maxScan)).length;
  const securityScreeningCount = (await scanSecurityScreenings(e, maxScan)).length;
  return {
    shipmentCount,
    uldAssignmentCount,
    awbPartiesCount,
    cargoClaimCount,
    securityScreeningCount,
    shipmentsByDest,
    truncated:
      shipmentCount >= maxScan ||
      uldAssignmentCount >= maxScan ||
      awbPartiesCount >= maxScan ||
      cargoClaimCount >= maxScan ||
      securityScreeningCount >= maxScan,
  };
}
