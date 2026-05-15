"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/index.ts
var src_exports = {};
__export(src_exports, {
  EVENT_TYPES: () => EVENT_TYPES,
  buildEvent: () => buildEvent,
  sendWebhook: () => sendWebhook,
  signRequest: () => signRequest,
  verifyAndParse: () => verifyAndParse,
  verifySignature: () => verifySignature
});
module.exports = __toCommonJS(src_exports);

// src/types.ts
var EVENT_TYPES = {
  POST_PUBLISHED: "post.published.v1",
  POST_UPDATED: "post.updated.v1",
  POST_UNPUBLISHED: "post.unpublished.v1",
  POST_DELETED: "post.deleted.v1"
};

// src/sign.ts
var import_node_crypto = __toESM(require("crypto"), 1);
var SIG_VERSION = "v1";
function signRequest(input) {
  const { id, timestamp, body, secret } = input;
  if (!id) throw new Error("signRequest: id required");
  if (!Number.isFinite(timestamp)) throw new Error("signRequest: timestamp required");
  if (!secret) throw new Error("signRequest: secret required");
  const toSign = `${id}.${timestamp}.${body}`;
  const mac = import_node_crypto.default.createHmac("sha256", secret).update(toSign).digest("base64");
  return {
    "webhook-id": id,
    "webhook-timestamp": String(timestamp),
    "webhook-signature": `${SIG_VERSION},${mac}`
  };
}
function pickHeader(headers, name) {
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
function verifySignature(input) {
  const tolerance = input.toleranceSeconds ?? 5 * 60;
  const now = (input.now ?? (() => Math.floor(Date.now() / 1e3)))();
  const id = pickHeader(input.headers, "webhook-id");
  const ts = pickHeader(input.headers, "webhook-timestamp");
  const sig = pickHeader(input.headers, "webhook-signature");
  if (!id) return { ok: false, reason: "missing webhook-id" };
  if (!ts) return { ok: false, reason: "missing webhook-timestamp" };
  if (!sig) return { ok: false, reason: "missing webhook-signature" };
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
    secret: input.secret
  })["webhook-signature"];
  const candidates = sig.split(/\s+/).filter(Boolean);
  for (const cand of candidates) {
    if (timingSafeStringEqual(cand, expected)) {
      return { ok: true, id, timestamp: tsNum };
    }
  }
  return { ok: false, reason: "signature mismatch" };
}
function timingSafeStringEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length !== b.length) return false;
  return import_node_crypto.default.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

// src/sender.ts
var import_node_crypto2 = __toESM(require("crypto"), 1);
var DEFAULT_TIMEOUT_MS = 1e4;
var DEFAULT_USER_AGENT = "@profullstack/autoblog/0.1";
var DEFAULT_RETRY_DELAYS_MS = [0, 1e4, 6e4];
function reverseDns(source) {
  try {
    const host = new URL(source).hostname.replace(/^www\./, "");
    return host.split(".").reverse().join(".");
  } catch {
    return "unknown";
  }
}
function buildEvent(post, opts) {
  const eventId = opts.eventId ?? import_node_crypto2.default.randomUUID();
  const type = opts.type ?? `${reverseDns(opts.source)}.post.published.v1`;
  return {
    specversion: "1.0",
    id: eventId,
    type,
    source: opts.source,
    subject: `post:${post.id}`,
    time: opts.time ?? (/* @__PURE__ */ new Date()).toISOString(),
    datacontenttype: "application/json",
    data: { post }
  };
}
function shouldRetry(status) {
  if (status === null) return true;
  if (status >= 500) return true;
  if (status === 408 || status === 429) return true;
  return false;
}
async function postOnce(url, body, headers, timeoutMs, fetchImpl) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, {
      method: "POST",
      headers,
      body,
      redirect: "follow",
      signal: controller.signal
    });
    return { status: res.status };
  } catch (err) {
    return {
      status: null,
      error: err instanceof Error ? err.message : String(err)
    };
  } finally {
    clearTimeout(timer);
  }
}
async function sendWebhook(url, event, opts) {
  const body = JSON.stringify(event);
  const timestamp = Math.floor(Date.now() / 1e3);
  const headers = {
    "content-type": "application/cloudevents+json",
    authorization: `Bearer ${opts.secret}`,
    "user-agent": opts.userAgent ?? DEFAULT_USER_AGENT,
    ...signRequest({ id: event.id, timestamp, body, secret: opts.secret })
  };
  const delays = opts.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let attempt = 0;
  let lastStatus = null;
  let lastError;
  while (attempt < delays.length) {
    const delay = delays[attempt] ?? 0;
    if (delay > 0) await new Promise((r2) => setTimeout(r2, delay));
    attempt++;
    const r = await postOnce(url, body, headers, timeoutMs, fetchImpl);
    lastStatus = r.status;
    lastError = r.error;
    if (r.status !== null && r.status >= 200 && r.status < 300) {
      return { ok: true, status: r.status, attempts: attempt };
    }
    if (!shouldRetry(r.status)) break;
  }
  return {
    ok: false,
    status: lastStatus,
    attempts: attempt,
    error: lastError ?? (lastStatus !== null ? `HTTP ${lastStatus}` : "unknown error")
  };
}

// src/receiver.ts
var import_node_crypto3 = require("crypto");
function pickHeader2(headers, name) {
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
function bearerMatches(provided, expected) {
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return (0, import_node_crypto3.timingSafeEqual)(a, b);
}
function isValidPost(p) {
  if (!p || typeof p !== "object") return false;
  const o = p;
  return typeof o.id === "string" && typeof o.title === "string" && typeof o.slug === "string" && typeof o.html === "string" && typeof o.status === "string" && typeof o.published_at === "string" && Array.isArray(o.tags) && Array.isArray(o.categories);
}
function isValidEnvelope(e) {
  if (!e || typeof e !== "object") return false;
  const o = e;
  if (o.specversion !== "1.0") return false;
  if (typeof o.id !== "string") return false;
  if (typeof o.type !== "string") return false;
  if (typeof o.source !== "string") return false;
  if (!o.data || typeof o.data !== "object") return false;
  const data = o.data;
  return isValidPost(data.post);
}
function verifyAndParse(input) {
  const { headers, body, opts } = input;
  const bearer = (pickHeader2(headers, "authorization") ?? "").replace(
    /^Bearer\s+/i,
    ""
  );
  const expectedBearer = opts.expectedBearer ?? opts.secret;
  if (!bearerMatches(bearer, expectedBearer)) {
    return { ok: false, status: 401, reason: "invalid bearer" };
  }
  const sig = verifySignature({
    headers,
    body,
    secret: opts.secret,
    toleranceSeconds: opts.toleranceSeconds
  });
  if (!sig.ok) {
    return { ok: false, status: 401, reason: sig.reason };
  }
  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    return { ok: false, status: 400, reason: "invalid JSON" };
  }
  if (!isValidEnvelope(parsed)) {
    return { ok: false, status: 400, reason: "invalid event envelope" };
  }
  return {
    ok: true,
    event: parsed,
    post: parsed.data.post
  };
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  EVENT_TYPES,
  buildEvent,
  sendWebhook,
  signRequest,
  verifyAndParse,
  verifySignature
});
//# sourceMappingURL=index.cjs.map