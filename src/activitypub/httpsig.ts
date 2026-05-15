// HTTP Signatures (draft-cavage-http-signatures-12) — the variant
// Mastodon and the rest of the Fediverse implement. Signs/verifies
// outbound and inbound POSTs against an actor's RSA-SHA256 key.
//
// Signed pseudo-headers (in this exact order, joined by "\n"):
//   (request-target) post /path?query
//   host: example.com
//   date: Thu, 15 May 2026 12:34:56 GMT
//   digest: SHA-256=<base64-sha256(body)>
//
// The Digest header is REQUIRED on POSTs — Mastodon rejects without it.
// We also support no-body GET signing (for fetching actor profiles).

import crypto from "node:crypto";

const SIGNED_HEADERS_POST = ["(request-target)", "host", "date", "digest"];
const SIGNED_HEADERS_GET = ["(request-target)", "host", "date"];

function rfc7231Date(d: Date = new Date()): string {
  return d.toUTCString();
}

function sha256Base64(s: string): string {
  return crypto.createHash("sha256").update(s).digest("base64");
}

export type SignHttpRequestOpts = {
  /** Full URL of the recipient (we need it for host + path). */
  url: string;
  method: "GET" | "POST";
  /** Body — required for POST, ignored for GET. */
  body?: string;
  /** Actor's keyId, e.g. `https://example.com/users/admin#main-key`. */
  keyId: string;
  /** PEM-encoded RSA private key. */
  privateKeyPem: string;
  /** Override `Date` header — testing only. */
  now?: () => Date;
};

export type SignedRequestHeaders = {
  host: string;
  date: string;
  digest?: string;
  signature: string;
  /** Content-Type the recipient expects for AP POSTs. */
  "content-type"?: string;
  /** Accept the recipient expects for AP GETs. */
  accept?: string;
};

export function signHttpRequest(opts: SignHttpRequestOpts): SignedRequestHeaders {
  const u = new URL(opts.url);
  const path = `${u.pathname}${u.search}`;
  const host = u.host;
  const date = rfc7231Date(opts.now?.() ?? new Date());
  const method = opts.method.toLowerCase();

  let digest: string | undefined;
  let signedHeaders = SIGNED_HEADERS_GET;
  if (method === "post") {
    if (opts.body === undefined) throw new Error("signHttpRequest: POST requires body");
    digest = `SHA-256=${sha256Base64(opts.body)}`;
    signedHeaders = SIGNED_HEADERS_POST;
  }

  const headersBlock = signedHeaders
    .map((h) => {
      if (h === "(request-target)") return `(request-target): ${method} ${path}`;
      if (h === "host") return `host: ${host}`;
      if (h === "date") return `date: ${date}`;
      if (h === "digest") return `digest: ${digest}`;
      return "";
    })
    .join("\n");

  const sig = crypto
    .createSign("RSA-SHA256")
    .update(headersBlock)
    .sign(opts.privateKeyPem, "base64");

  const signature =
    `keyId="${opts.keyId}",` +
    `algorithm="rsa-sha256",` +
    `headers="${signedHeaders.join(" ")}",` +
    `signature="${sig}"`;

  const out: SignedRequestHeaders = { host, date, signature };
  if (digest) {
    out.digest = digest;
    out["content-type"] = "application/activity+json";
  } else {
    out.accept = 'application/activity+json, application/ld+json; profile="https://www.w3.org/ns/activitystreams"';
  }
  return out;
}

// ------------------------------------------------------------
// Verifying inbound signatures
// ------------------------------------------------------------

export type VerifyHttpSignatureInput = {
  method: string;
  url: string; // request URL as the server sees it
  headers: Record<string, string | string[] | undefined>;
  body: string;
  /** Resolve the actor's public key PEM given its keyId. The keyId is
   *  typically `<actor>#main-key`; the caller fetches `<actor>` and
   *  reads `publicKey.publicKeyPem` from the JSON-LD response. */
  fetchPublicKey: (keyId: string) => Promise<string | null>;
  /** Reject signatures older than this many seconds. Default 5 min. */
  toleranceSeconds?: number;
  /** Test override. */
  now?: () => Date;
};

export type VerifyHttpSignatureResult =
  | { ok: true; keyId: string; signedHeaders: string[] }
  | { ok: false; reason: string };

function pickHeader(
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string | null {
  const lower = name.toLowerCase();
  for (const k of Object.keys(headers)) {
    if (k.toLowerCase() === lower) {
      const v = headers[k];
      if (Array.isArray(v)) return v[0] ?? null;
      return v ?? null;
    }
  }
  return null;
}

function parseSignatureHeader(value: string): Record<string, string> {
  const out: Record<string, string> = {};
  // Loosely parse `key="value",key="value"` allowing commas in values
  // is risky; the spec doesn't use them in practice so we split safely
  // on a regex that requires the equals + quote pattern.
  const re = /([a-zA-Z]+)="([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(value)) !== null) {
    if (m[1] && m[2] !== undefined) out[m[1]] = m[2];
  }
  return out;
}

export async function verifyHttpSignature(
  input: VerifyHttpSignatureInput,
): Promise<VerifyHttpSignatureResult> {
  const tolerance = input.toleranceSeconds ?? 5 * 60;
  const now = (input.now ?? (() => new Date()))();

  const sigHeader = pickHeader(input.headers, "signature");
  if (!sigHeader) return { ok: false, reason: "missing Signature header" };
  const parts = parseSignatureHeader(sigHeader);
  if (!parts.keyId) return { ok: false, reason: "Signature: keyId missing" };
  if (!parts.headers) return { ok: false, reason: "Signature: headers missing" };
  if (!parts.signature) return { ok: false, reason: "Signature: signature missing" };
  const algorithm = parts.algorithm ?? "rsa-sha256";
  if (algorithm !== "rsa-sha256") {
    return { ok: false, reason: `unsupported algorithm: ${algorithm}` };
  }

  const dateHdr = pickHeader(input.headers, "date");
  if (!dateHdr) return { ok: false, reason: "missing Date header" };
  const dateMs = Date.parse(dateHdr);
  if (Number.isNaN(dateMs)) return { ok: false, reason: "unparseable Date header" };
  if (Math.abs(now.getTime() - dateMs) / 1000 > tolerance) {
    return { ok: false, reason: "date outside tolerance" };
  }

  // Verify digest if signed.
  const signed = parts.headers.split(/\s+/).filter(Boolean);
  if (signed.includes("digest")) {
    const digestHdr = pickHeader(input.headers, "digest");
    if (!digestHdr) return { ok: false, reason: "Digest header missing but signed" };
    if (!digestHdr.startsWith("SHA-256=")) {
      return { ok: false, reason: "unsupported digest algorithm" };
    }
    const expected = `SHA-256=${sha256Base64(input.body)}`;
    if (digestHdr !== expected) return { ok: false, reason: "digest mismatch" };
  }

  const u = new URL(input.url);
  const path = `${u.pathname}${u.search}`;
  const block = signed
    .map((h) => {
      if (h === "(request-target)") return `(request-target): ${input.method.toLowerCase()} ${path}`;
      const v = pickHeader(input.headers, h);
      if (v === null) return null;
      return `${h.toLowerCase()}: ${v}`;
    })
    .join("\n");
  if (block.includes("null")) {
    // A signed header wasn't present in the request — bail.
    return { ok: false, reason: "signed header missing from request" };
  }

  const pubKeyPem = await input.fetchPublicKey(parts.keyId);
  if (!pubKeyPem) return { ok: false, reason: "could not fetch public key" };

  let valid = false;
  try {
    valid = crypto
      .createVerify("RSA-SHA256")
      .update(block)
      .verify(pubKeyPem, parts.signature, "base64");
  } catch (err) {
    return {
      ok: false,
      reason: `verify error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  if (!valid) return { ok: false, reason: "signature mismatch" };
  return { ok: true, keyId: parts.keyId, signedHeaders: signed };
}
