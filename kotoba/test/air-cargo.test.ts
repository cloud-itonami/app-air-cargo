import { describe, it, expect, beforeEach } from "vitest";
import { MockEtzhayyim } from "@etzhayyim/sdk-mock";
import {
  registerShipment,
  trackShipment,
  getShipment,
  listShipments,
  assignUld,
  listUldAssignments,
  issueAirWaybill,
  getAwbParties,
  fileCargoClaim,
  reportCargoSecurity,
  coverage,
} from "../src/index.js";

const OWNER = "did:web:air-cargo.etzhayyim.com";

describe("air-cargo kotoba (kotoba-E2E split)", () => {
  let e: any;
  beforeEach(() => {
    e = new MockEtzhayyim({ did: OWNER });
  });

  describe("shipment + uldAssignment (PLAINTEXT operational anchors)", () => {
    it("registers, dedups, validates, tracks, gets, lists/filters", async () => {
      expect((await registerShipment(e, { awbNo: "020-12345675", origin: "NRT", dest: "LAX", commodity: "electronics", grossWeightKg: "1250.5", pieces: 4 })).status).toBe("registered");
      expect((await registerShipment(e, { awbNo: "020-12345675", origin: "NRT", dest: "LAX" })).status).toBe("alreadyExists");
      expect((await registerShipment(e, { awbNo: "x", origin: "NRT", dest: "LAX", pieces: -1 })).status).toBe("rejected");
      expect((await registerShipment(e, { awbNo: "y", origin: "NRT", dest: "LAX", grossWeightKg: "1.2.3" })).status).toBe("rejected");
      expect((await registerShipment(e, { awbNo: "z", origin: "", dest: "LAX" })).status).toBe("rejected");

      await registerShipment(e, { awbNo: "020-99999999", origin: "NRT", dest: "SFO" });
      expect((await trackShipment(e, { awbNo: "020-12345675", status: "departed", location: "NRT" })).status).toBe("updated");
      expect((await trackShipment(e, { awbNo: "no-such", status: "departed" })).status).toBe("rejected");

      const got = await getShipment(e, { awbNo: "020-12345675" });
      expect(got.shipment?.status).toBe("departed");
      expect(got.shipment?.dest).toBe("LAX");
      expect((await getShipment(e, { awbNo: "no-such" })).error).toBe("notFound");

      expect((await listShipments(e)).total).toBe(2);
      expect((await listShipments(e, { dest: "LAX" })).total).toBe(1);
      expect((await listShipments(e, { status: "departed" })).total).toBe(1);
    });

    it("FK: uldAssignment requires an existing shipment (exists check)", async () => {
      expect((await assignUld(e, { awbNo: "020-12345675", uldNo: "AKE12345AB", flightNo: "NH006" })).status).toBe("rejected"); // no shipment yet
      await registerShipment(e, { awbNo: "020-12345675", origin: "NRT", dest: "LAX" });
      expect((await assignUld(e, { awbNo: "020-12345675", uldNo: "AKE12345AB", uldType: "AKE", flightNo: "NH006", depDate: "2026-06-10" })).status).toBe("assigned");
      expect((await assignUld(e, { awbNo: "020-12345675", uldNo: "AKE12345AB", flightNo: "NH006" })).status).toBe("alreadyExists");
      expect((await listUldAssignments(e)).total).toBe(1);
      expect((await listUldAssignments(e, { flightNo: "NH006" })).total).toBe(1);
      expect((await listUldAssignments(e, { flightNo: "ZZ000" })).total).toBe(0);
    });
  });

  describe("awbParties (E2E-ENCRYPTED PII/CUI)", () => {
    it("seals via encryptedWrite, round-trips via encryptedRead, validates", async () => {
      const ok = await issueAirWaybill(e, { awbNo: "020-12345675", shipperName: "Acme Exports KK", consigneeName: "Jane Doe", shipperDid: "did:web:acme.example", consigneeDid: "did:web:jane.example", commodity: "electronics", pieces: 4, grossWeightKg: "1250.5" });
      expect(ok.status).toBe("issued");
      expect(ok.keyId).toBeTruthy();
      expect((await issueAirWaybill(e, { awbNo: "x", shipperName: "", consigneeName: "Y" })).status).toBe("rejected");
      expect((await issueAirWaybill(e, { awbNo: "x", shipperName: "A", consigneeName: "B", grossWeightKg: "abc" })).status).toBe("rejected");

      const got = await getAwbParties(e, { awbNo: "020-12345675" });
      expect(got.parties?.shipperName).toBe("Acme Exports KK");
      expect(got.parties?.consigneeDid).toBe("did:web:jane.example");
      expect((await getAwbParties(e, { awbNo: "no-such" })).error).toBe("notFound");
    });

    it("enforces read-cap: a non-recipient DID sees zero parties (isolation by owner DID)", async () => {
      await issueAirWaybill(e, { awbNo: "020-12345675", shipperName: "Acme", consigneeName: "Jane" });
      const outsider: any = new MockEtzhayyim({ did: "did:web:outsider.example" });
      expect((await getAwbParties(outsider, { awbNo: "020-12345675" })).error).toBe("notFound");
    });

    it("grants read-cap to an explicit recipient", async () => {
      const partner = "did:web:carrier.example";
      const r = await issueAirWaybill(e, { awbNo: "020-12345675", shipperName: "Acme", consigneeName: "Jane", recipients: [partner] });
      expect(r.status).toBe("issued");
      expect((await getAwbParties(e, { awbNo: "020-12345675" })).parties?.shipperName).toBe("Acme");
    });
  });

  describe("cargoClaim + securityScreening (E2E-ENCRYPTED financial / LE)", () => {
    it("files a confidential claim and reports a screening, both sealed", async () => {
      const c = await fileCargoClaim(e, { claimId: "CLM-1", awbNo: "020-12345675", claimType: "damage", claimAmount: "4500.00", currency: "USD" });
      expect(c.status).toBe("filed");
      expect(c.keyId).toBeTruthy();
      expect((await fileCargoClaim(e, { claimId: "CLM-2", awbNo: "a", claimType: "loss", claimAmount: "not-a-number" })).status).toBe("rejected");

      const s = await reportCargoSecurity(e, { screeningId: "SCR-1", awbNo: "020-12345675", securityCheckType: "x-ray", result: "cleared", screenerId: "AGT-77" });
      expect(s.status).toBe("reported");
      expect(s.keyId).toBeTruthy();
      expect((await reportCargoSecurity(e, { screeningId: "", awbNo: "a", securityCheckType: "x-ray", result: "cleared" })).status).toBe("rejected");
    });
  });

  describe("coverage rollup", () => {
    it("counts plaintext anchors + E2E sensitive across all paths", async () => {
      await registerShipment(e, { awbNo: "020-11111111", origin: "NRT", dest: "LAX" });
      await registerShipment(e, { awbNo: "020-22222222", origin: "NRT", dest: "LAX" });
      await registerShipment(e, { awbNo: "020-33333333", origin: "HND", dest: "SFO" });
      await assignUld(e, { awbNo: "020-11111111", uldNo: "AKE001", flightNo: "NH006" });
      await issueAirWaybill(e, { awbNo: "020-11111111", shipperName: "Acme", consigneeName: "Jane" });
      await fileCargoClaim(e, { claimId: "CLM-1", awbNo: "020-11111111", claimType: "damage", claimAmount: "100.00" });
      await reportCargoSecurity(e, { screeningId: "SCR-1", awbNo: "020-11111111", securityCheckType: "x-ray", result: "cleared" });

      const cov = await coverage(e);
      expect(cov.shipmentCount).toBe(3);
      expect(cov.uldAssignmentCount).toBe(1);
      expect(cov.awbPartiesCount).toBe(1);
      expect(cov.cargoClaimCount).toBe(1);
      expect(cov.securityScreeningCount).toBe(1);
      expect(cov.shipmentsByDest?.LAX).toBe(2);
      expect(cov.shipmentsByDest?.SFO).toBe(1);
      expect(cov.truncated).toBe(false);
    });
  });
});
