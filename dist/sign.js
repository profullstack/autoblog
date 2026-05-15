// Standard Webhooks signing / verification.
// Spec: https://www.standardwebhooks.com/
//
// We sign over the canonical string `${webhook-id}.${webhook-timestamp}.${body}`
// with HMAC-SHA256 and base64-encode the result, prefixed with the
// version tag `v1`. Receivers reject signatures whose timestamp is
// outside the tolerance window (default 5 minutes) to neuter replay
// attacks even if a delivery is captured.
import crypto from "node:crypto";
const SIG_VERSION = "v1";
export function signRequest(input) {
    const { id, timestamp, body, secret } = input;
    if (!id)
        throw new Error("signRequest: id required");
    if (!Number.isFinite(timestamp))
        throw new Error("signRequest: timestamp required");
    if (!secret)
        throw new Error("signRequest: secret required");
    const toSign = `${id}.${timestamp}.${body}`;
    const mac = crypto
        .createHmac("sha256", secret)
        .update(toSign)
        .digest("base64");
    return {
        "webhook-id": id,
        "webhook-timestamp": String(timestamp),
        "webhook-signature": `${SIG_VERSION},${mac}`,
    };
}
function pickHeader(headers, name) {
    const lower = name.toLowerCase();
    for (const k of Object.keys(headers)) {
        if (k.toLowerCase() === lower) {
            const v = headers[k];
            if (Array.isArray(v))
                return v[0] ?? null;
            return v ?? null;
        }
    }
    return null;
}
export function verifySignature(input) {
    const tolerance = input.toleranceSeconds ?? 5 * 60;
    const now = (input.now ?? (() => Math.floor(Date.now() / 1000)))();
    const id = pickHeader(input.headers, "webhook-id");
    const ts = pickHeader(input.headers, "webhook-timestamp");
    const sig = pickHeader(input.headers, "webhook-signature");
    if (!id)
        return { ok: false, reason: "missing webhook-id" };
    if (!ts)
        return { ok: false, reason: "missing webhook-timestamp" };
    if (!sig)
        return { ok: false, reason: "missing webhook-signature" };
    const tsNum = parseInt(ts, 10);
    if (!Number.isFinite(tsNum)) {
        return { ok: false, reason: "invalid webhook-timestamp" };
    }
    if (Math.abs(now - tsNum) > tolerance) {
        return { ok: false, reason: "timestamp outside tolerance" };
    }
    const expected = signRequest({
        id,
        timestamp: tsNum,
        body: input.body,
        secret: input.secret,
    })["webhook-signature"];
    // Standard Webhooks allows multiple space-separated signatures in the
    // header (versioned rotation). Accept if ANY matches.
    const candidates = sig.split(/\s+/).filter(Boolean);
    for (const cand of candidates) {
        if (timingSafeStringEqual(cand, expected)) {
            return { ok: true, id, timestamp: tsNum };
        }
    }
    return { ok: false, reason: "signature mismatch" };
}
function timingSafeStringEqual(a, b) {
    if (typeof a !== "string" || typeof b !== "string")
        return false;
    if (a.length !== b.length)
        return false;
    return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}
//# sourceMappingURL=sign.js.map