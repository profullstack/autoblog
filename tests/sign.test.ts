import { describe, it, expect } from "vitest";
import { signRequest, verifySignature } from "../src/sign.js";

describe("signRequest", () => {
  it("produces a v1-tagged base64 HMAC", () => {
    const out = signRequest({
      id: "evt_1",
      timestamp: 1_770_000_000,
      body: '{"hello":"world"}',
      secret: "s3cret",
    });
    expect(out["webhook-id"]).toBe("evt_1");
    expect(out["webhook-timestamp"]).toBe("1770000000");
    expect(out["webhook-signature"]).toMatch(/^v1,[A-Za-z0-9+/=]+$/);
  });

  it("is deterministic for the same inputs", () => {
    const a = signRequest({ id: "x", timestamp: 1, body: "b", secret: "k" });
    const b = signRequest({ id: "x", timestamp: 1, body: "b", secret: "k" });
    expect(a["webhook-signature"]).toBe(b["webhook-signature"]);
  });

  it("changes when any input changes", () => {
    const base = signRequest({ id: "x", timestamp: 1, body: "b", secret: "k" });
    expect(signRequest({ id: "y", timestamp: 1, body: "b", secret: "k" })["webhook-signature"]).not.toBe(base["webhook-signature"]);
    expect(signRequest({ id: "x", timestamp: 2, body: "b", secret: "k" })["webhook-signature"]).not.toBe(base["webhook-signature"]);
    expect(signRequest({ id: "x", timestamp: 1, body: "B", secret: "k" })["webhook-signature"]).not.toBe(base["webhook-signature"]);
    expect(signRequest({ id: "x", timestamp: 1, body: "b", secret: "K" })["webhook-signature"]).not.toBe(base["webhook-signature"]);
  });
});

describe("verifySignature", () => {
  const secret = "shared";
  const id = "evt_42";
  const now = 1_770_000_000;
  const body = '{"data":{"post":{"id":"p1"}}}';
  const headers = (() => {
    const signed = signRequest({ id, timestamp: now, body, secret });
    return {
      "webhook-id": signed["webhook-id"],
      "webhook-timestamp": signed["webhook-timestamp"],
      "webhook-signature": signed["webhook-signature"],
    };
  })();

  it("accepts a fresh, well-signed delivery", () => {
    const r = verifySignature({ headers, body, secret, now: () => now });
    expect(r.ok).toBe(true);
  });

  it("rejects if any header is missing", () => {
    const noId = { ...headers, "webhook-id": undefined as any };
    expect(verifySignature({ headers: noId, body, secret, now: () => now }).ok).toBe(false);
    const noTs = { ...headers, "webhook-timestamp": undefined as any };
    expect(verifySignature({ headers: noTs, body, secret, now: () => now }).ok).toBe(false);
    const noSig = { ...headers, "webhook-signature": undefined as any };
    expect(verifySignature({ headers: noSig, body, secret, now: () => now }).ok).toBe(false);
  });

  it("rejects body tampering", () => {
    const r = verifySignature({
      headers,
      body: body + " ",
      secret,
      now: () => now,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/mismatch/);
  });

  it("rejects wrong secret", () => {
    const r = verifySignature({ headers, body, secret: "other", now: () => now });
    expect(r.ok).toBe(false);
  });

  it("rejects out-of-tolerance timestamps", () => {
    const future = now + 10 * 60; // 10 minutes ahead, default tolerance is 5
    const r = verifySignature({ headers, body, secret, now: () => future });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/tolerance/);
  });

  it("accepts case-insensitive header keys (Node sometimes Camel-Cases them)", () => {
    const upper = {
      "Webhook-Id": headers["webhook-id"],
      "Webhook-Timestamp": headers["webhook-timestamp"],
      "Webhook-Signature": headers["webhook-signature"],
    };
    const r = verifySignature({ headers: upper, body, secret, now: () => now });
    expect(r.ok).toBe(true);
  });
});
