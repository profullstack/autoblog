// Sender helpers. The producer (e.g. crawlproof.com) constructs an
// event, signs it, and POSTs it. We provide a one-shot `sendWebhook`
// with sensible retry policy; callers can also use `buildEvent` +
// `signRequest` independently if they want to manage transport
// themselves.
import crypto from "node:crypto";
import { signRequest } from "./sign.js";
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_USER_AGENT = "@profullstack/autoblog/0.1";
const DEFAULT_RETRY_DELAYS_MS = [0, 10_000, 60_000];
function reverseDns(source) {
    try {
        const host = new URL(source).hostname.replace(/^www\./, "");
        return host.split(".").reverse().join(".");
    }
    catch {
        return "unknown";
    }
}
export function buildEvent(post, opts) {
    const eventId = opts.eventId ?? crypto.randomUUID();
    const type = opts.type ?? `${reverseDns(opts.source)}.post.published.v1`;
    return {
        specversion: "1.0",
        id: eventId,
        type,
        source: opts.source,
        subject: `post:${post.id}`,
        time: opts.time ?? new Date().toISOString(),
        datacontenttype: "application/json",
        data: { post },
    };
}
function shouldRetry(status) {
    if (status === null)
        return true; // network / timeout
    if (status >= 500)
        return true;
    if (status === 408 || status === 429)
        return true;
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
            signal: controller.signal,
        });
        return { status: res.status };
    }
    catch (err) {
        return {
            status: null,
            error: err instanceof Error ? err.message : String(err),
        };
    }
    finally {
        clearTimeout(timer);
    }
}
export async function sendWebhook(url, event, opts) {
    const body = JSON.stringify(event);
    const timestamp = Math.floor(Date.now() / 1000);
    const headers = {
        "content-type": "application/cloudevents+json",
        authorization: `Bearer ${opts.secret}`,
        "user-agent": opts.userAgent ?? DEFAULT_USER_AGENT,
        ...signRequest({ id: event.id, timestamp, body, secret: opts.secret }),
    };
    const delays = opts.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;
    const fetchImpl = opts.fetchImpl ?? fetch;
    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    let attempt = 0;
    let lastStatus = null;
    let lastError;
    while (attempt < delays.length) {
        const delay = delays[attempt] ?? 0;
        if (delay > 0)
            await new Promise((r) => setTimeout(r, delay));
        attempt++;
        const r = await postOnce(url, body, headers, timeoutMs, fetchImpl);
        lastStatus = r.status;
        lastError = r.error;
        if (r.status !== null && r.status >= 200 && r.status < 300) {
            return { ok: true, status: r.status, attempts: attempt };
        }
        if (!shouldRetry(r.status))
            break;
    }
    return {
        ok: false,
        status: lastStatus,
        attempts: attempt,
        error: lastError ?? (lastStatus !== null ? `HTTP ${lastStatus}` : "unknown error"),
    };
}
//# sourceMappingURL=sender.js.map