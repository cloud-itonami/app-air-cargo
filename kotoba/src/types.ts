/**
 * air-cargo kotoba — kotoba-E2E split for airline cargo operations.
 *
 * Per ADR-2606011400 (Consensys) + ADR-2605172400 (3-axis) + ADR-2605181100
 * (kotoba E2E encrypted-record envelope). Founder directive 2026-06-03: PII /
 * CUI / LE may migrate to etzhayyim when made safe via kotoba E2E.
 *
 * SPLIT (discriminator: a field is E2E if it carries a person/counterparty
 * identity, a confidential commercial term, or a security/LE result; pure
 * operational logistics facts are plaintext):
 *
 *   PUBLIC (plaintext AT records) — operational logistics anchors with NO party
 *   identity: `shipment` (awb_no, origin, dest, commodity, weight, pieces,
 *   status) and `uldAssignment` (ULD ↔ flight load plan). FK uldAssignment →
 *   shipment via exists(). Frontable open metadata + aggregate stats.
 *
 *   SENSITIVE (kotoba E2E, com.etzhayyim.encrypted.record) — `awbParties`
 *   (shipper/consignee names + DIDs = PII/CUI trade-document parties) and
 *   `cargoClaim` (confidential damage/loss/delay financial claim) and
 *   `securityScreening` (TSA/ICAO screening result + screener personnel id =
 *   LE result + PII). Written via sdk.encryptedWrite (read-cap = owner DID +
 *   explicit recipients). The substrate never sees these in plaintext.
 *
 *   STAYS etzhayyim (consumed via consent-capability, NOT a collection) — CASS
 *   cargo-account settlement EXECUTION (settleCargoAccount fiat money movement
 *   via IATA CASS clearing) is regulated fiat settlement; only the EXECUTION
 *   act stays etzhayyim.
 *
 * AT-Lexicon: no float — weights/amounts are decimal STRINGS; pieces is integer.
 */

// ─── Plaintext public collections ───────────────────────────────────
export const SHIPMENT_COLLECTION = "com.etzhayyim.apps.airCargo.shipment";
export const ULD_ASSIGNMENT_COLLECTION = "com.etzhayyim.apps.airCargo.uldAssignment";

// ─── E2E inner-type NSIDs (body shape inside the encrypted envelope) ──
export const AWB_PARTIES_INNER_TYPE = "com.etzhayyim.apps.airCargo.awbParties";
export const CARGO_CLAIM_INNER_TYPE = "com.etzhayyim.apps.airCargo.cargoClaim";
export const SECURITY_SCREENING_INNER_TYPE = "com.etzhayyim.apps.airCargo.securityScreening";

export const AIR_CARGO_DID_PREFIX = "did:web:air-cargo.etzhayyim.com:" as const;

// ─── Shipment anchor (PLAINTEXT, public operational metadata) ────────

export interface ShipmentRecord {
  did: string;
  awbNo: string;
  origin: string;
  dest: string;
  commodity?: string;
  /** decimal kilograms as string (no float). */
  grossWeightKg?: string;
  pieces?: number;
  status: string;
  location?: string;
  createdAt: string;
}
export interface ShipmentView extends ShipmentRecord {
  shipmentUri: string;
}
export interface RegisterShipmentInput {
  awbNo: string;
  origin: string;
  dest: string;
  commodity?: string;
  grossWeightKg?: string;
  pieces?: number;
  status?: string;
  location?: string;
}
export interface RegisterShipmentOutput {
  status: "registered" | "alreadyExists" | "rejected";
  shipmentUri?: string;
  did?: string;
  awbNo?: string;
  error?: string;
}
export interface TrackShipmentInput {
  awbNo: string;
  status: string;
  location?: string;
}
export interface TrackShipmentOutput {
  status: "updated" | "rejected";
  shipmentUri?: string;
  awbNo?: string;
  error?: string;
}
export interface GetShipmentInput {
  awbNo: string;
}
export interface GetShipmentOutput {
  shipment?: ShipmentView;
  error?: string;
}
export interface ListShipmentsInput {
  dest?: string;
  status?: string;
  limit?: number;
  cursor?: string;
}
export interface ListShipmentsOutput {
  items: ShipmentView[];
  cursor?: string;
  total: number;
}

// ─── ULD assignment (PLAINTEXT, FK → shipment) ──────────────────────

export interface UldAssignmentRecord {
  did: string;
  awbNo: string;
  uldNo: string;
  uldType?: string;
  flightNo: string;
  depDate?: string;
  createdAt: string;
}
export interface UldAssignmentView extends UldAssignmentRecord {
  assignmentUri: string;
}
export interface AssignUldInput {
  awbNo: string;
  uldNo: string;
  uldType?: string;
  flightNo: string;
  depDate?: string;
}
export interface AssignUldOutput {
  status: "assigned" | "alreadyExists" | "rejected";
  assignmentUri?: string;
  did?: string;
  error?: string;
}
export interface ListUldAssignmentsInput {
  awbNo?: string;
  flightNo?: string;
  limit?: number;
  cursor?: string;
}
export interface ListUldAssignmentsOutput {
  items: UldAssignmentView[];
  cursor?: string;
  total: number;
}

// ─── AWB parties (E2E-ENCRYPTED, PII/CUI) ───────────────────────────

export interface AwbPartiesBody {
  awbNo: string;
  shipperName: string;
  consigneeName: string;
  shipperDid?: string;
  consigneeDid?: string;
  commodity?: string;
  pieces?: number;
  grossWeightKg?: string;
}
export interface AwbPartiesView extends AwbPartiesBody {
  uri: string;
  sender: string;
  createdAt: string;
}
export interface IssueAwbInput {
  awbNo: string;
  shipperName: string;
  consigneeName: string;
  shipperDid?: string;
  consigneeDid?: string;
  commodity?: string;
  pieces?: number;
  grossWeightKg?: string;
  /** Extra DIDs to grant read-cap (owner always included). */
  recipients?: string[];
}
export interface IssueAwbOutput {
  status: "issued" | "rejected";
  uri?: string;
  keyId?: string;
  awbNo?: string;
  error?: string;
}
export interface GetAwbPartiesInput {
  awbNo: string;
}
export interface GetAwbPartiesOutput {
  parties?: AwbPartiesView;
  error?: string;
}

// ─── Cargo claim (E2E-ENCRYPTED, confidential financial) ────────────

export interface CargoClaimBody {
  claimId: string;
  awbNo: string;
  claimType: string;
  /** decimal currency amount as string (no float). */
  claimAmount: string;
  currency?: string;
  filedAt: string;
}
export interface CargoClaimView extends CargoClaimBody {
  uri: string;
  sender: string;
  createdAt: string;
}
export interface FileClaimInput {
  claimId: string;
  awbNo: string;
  claimType: string;
  claimAmount: string;
  currency?: string;
  recipients?: string[];
}
export interface FileClaimOutput {
  status: "filed" | "rejected";
  uri?: string;
  keyId?: string;
  claimId?: string;
  error?: string;
}

// ─── Security screening (E2E-ENCRYPTED, LE result + PII) ────────────

export interface SecurityScreeningBody {
  screeningId: string;
  awbNo: string;
  securityCheckType: string;
  result: string;
  screenerId?: string;
  screenedAt: string;
}
export interface SecurityScreeningView extends SecurityScreeningBody {
  uri: string;
  sender: string;
  createdAt: string;
}
export interface ReportSecurityInput {
  screeningId: string;
  awbNo: string;
  securityCheckType: string;
  result: string;
  screenerId?: string;
  recipients?: string[];
}
export interface ReportSecurityOutput {
  status: "reported" | "rejected";
  uri?: string;
  keyId?: string;
  screeningId?: string;
  error?: string;
}

// ─── Coverage rollup ────────────────────────────────────────────────

export interface CoverageInput {
  maxScan?: number;
}
export interface CoverageOutput {
  shipmentCount?: number;
  uldAssignmentCount?: number;
  awbPartiesCount?: number;
  cargoClaimCount?: number;
  securityScreeningCount?: number;
  shipmentsByDest?: Record<string, number>;
  truncated?: boolean;
  error?: string;
}

// ─── Validation + helpers ───────────────────────────────────────────

export function isUint(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n) && n >= 0;
}
/** Non-empty decimal string (e.g. "1250.5"); no float fields allowed. */
export function isDecimalString(s: unknown): s is string {
  return typeof s === "string" && /^\d+(\.\d+)?$/.test(s);
}
export function shipmentDidFor(awbNo: string): string {
  return `${AIR_CARGO_DID_PREFIX}awb:${awbNo.toLowerCase()}`;
}
export function uldDidFor(awbNo: string, uldNo: string): string {
  return `${AIR_CARGO_DID_PREFIX}uld:${awbNo.toLowerCase()}:${uldNo.toLowerCase()}`;
}
export function rkeyOf(prefix: string, id: string): string {
  return `${prefix}-${id.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
}
