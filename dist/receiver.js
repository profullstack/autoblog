// Receiver helpers. The consumer (a blog backend, Next.js route, etc.)
// passes the inbound request's headers + body + the shared secret;
// we verify the bearer, verify the Standard Webhooks signature, and
// return the parsed event. On failure we return a result with the
// reason and an appropriate HTTP status so the caller can map it
// straight into a Response.
import { timingSafeEqual } from "node:crypto";
import { verifySignature } from "./sign.js";
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
function bearerMatches(provided, expected) {
    if (!provided)
        return false;
    const a = Buffer.from(provided);
    const b = Buffer.from(expected);
    if (a.length !== b.length)
        return false;
    return timingSafeEqual(a, b);
}
// Type guard for the post shape so we 400 on garbage before touching
// the DB. We don't validate every field — just the ones the receiver
// will read.
function isValidPost(p) {
    if (!p || typeof p !== "object")
        return false;
    const o = p;
    return (typeof o.id === "string" &&
        typeof o.title === "string" &&
        typeof o.slug === "string" &&
        typeof o.html === "string" &&
        typeof o.status === "string" &&
        typeof o.published_at === "string" &&
        Array.isArray(o.tags) &&
        Array.isArray(o.categories));
}
function isValidEnvelope(e) {
    if (!e || typeof e !== "object")
        return false;
    const o = e;
    if (o.specversion !== "1.0")
        return false;
    if (typeof o.id !== "string")
        return false;
    if (typeof o.type !== "string")
        return false;
    if (typeof o.source !== "string")
        return false;
    if (!o.data || typeof o.data !== "object")
        return false;
    const data = o.data;
    return isValidPost(data.post);
}
/**
 * Verify auth + signature and parse the body. The caller passes the
 * raw request text (NOT `await req.json()` — the signature is over the
 * bytes as received).
 */
export function verifyAndParse(input) {
    const { headers, body, opts } = input;
    // 1. Bearer.
    const bearer = (pickHeader(headers, "authorization") ?? "").replace(/^Bearer\s+/i, "");
    const expectedBearer = opts.expectedBearer ?? opts.secret;
    if (!bearerMatches(bearer, expectedBearer)) {
        return { ok: false, status: 401, reason: "invalid bearer" };
    }
    // 2. Signature.
    const sig = verifySignature({
        headers,
        body,
        secret: opts.secret,
        toleranceSeconds: opts.toleranceSeconds,
    });
    if (!sig.ok) {
        return { ok: false, status: 401, reason: sig.reason };
    }
    // 3. Body shape.
    let parsed;
    try {
        parsed = JSON.parse(body);
    }
    catch {
        return { ok: false, status: 400, reason: "invalid JSON" };
    }
    if (!isValidEnvelope(parsed)) {
        return { ok: false, status: 400, reason: "invalid event envelope" };
    }
    return {
        ok: true,
        event: parsed,
        post: parsed.data.post,
    };
}
//# sourceMappingURL=receiver.js.map