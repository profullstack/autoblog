// Sender helpers. The producer (e.g. crawlproof.com) constructs an
// event, signs it, and POSTs it. We provide a one-shot `sendWebhook`
// with sensible retry policy; callers can also use `buildEvent` +
// `signRequest` independently if they want to manage transport
// themselves.

import crypto from "node:crypto";
import { signRequest } from "./sign.js";
import type { Post, PostPublishedEvent } from "./types.js";

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_USER_AGENT = "@profullstack/autoblog/0.1";
const DEFAULT_RETRY_DELAYS_MS = [0, 10_000, 60_000];

export type BuildEventOpts = {
  /** Producer URL — e.g. "https://crawlproof.com". Used as the
   *  CloudEvents `source` and to namespace the event type. */
  source: string;
  /** Event type. Defaults to `post.published.v1` namespaced under the
   *  source hostname's reverse DNS (`com.example.post.published.v1`). */
  type?: string;
  /** Stable event ID; one is generated if omitted. */
  eventId?: string;
  /** Override CloudEvents `time` — testing only. */
  time?: string;
};

function reverseDns(source: string): string {
  try {
    const host = new URL(source).hostname.replace(/^www\./, "");
    return host.split(".").reverse().join(".");
  } catch {
    return "unknown";
  }
}

export function buildEvent(post: Post, opts: BuildEventOpts): PostPublishedEvent {
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

export type SendWebhookOpts = {
  /** Shared secret used as HMAC key. Same value the receiver has. */
  secret: string;
  /** Retry delays in ms. Defaults to [0, 10s, 60s]. Set to [0] to disable. */
  retryDelaysMs?: number[];
  /** Per-request timeout. Default 10s. */
  timeoutMs?: number;
  /** Override User-Agent header. */
  userAgent?: string;
  /** Override the fetch implementation — testing or custom transport. */
  fetchImpl?: typeof fetch;
};

export type DeliveryResult = {
  ok: boolean;
  status: number | null;
  attempts: number;
  error?: string;
};

function shouldRetry(status: number | null): boolean {
  if (status === null) return true; // network / timeout
  if (status >= 500) return true;
  if (status === 408 || status === 429) return true;
  return false;
}

async function postOnce(
  url: string,
  body: string,
  headers: Record<string, string>,
  timeoutMs: number,
  fetchImpl: typeof fetch,
): Promise<{ status: number | null; error?: string }> {
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
  } catch (err) {
    return {
      status: null,
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function sendWebhook(
  url: string,
  event: PostPublishedEvent,
  opts: SendWebhookOpts,
): Promise<DeliveryResult> {
  const body = JSON.stringify(event);
  const timestamp = Math.floor(Date.now() / 1000);
  const headers: Record<string, string> = {
    "content-type": "application/cloudevents+json",
    authorization: `Bearer ${opts.secret}`,
    "user-agent": opts.userAgent ?? DEFAULT_USER_AGENT,
    ...signRequest({ id: event.id, timestamp, body, secret: opts.secret }),
  };

  const delays = opts.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  let attempt = 0;
  let lastStatus: number | null = null;
  let lastError: string | undefined;

  while (attempt < delays.length) {
    const delay = delays[attempt] ?? 0;
    if (delay > 0) await new Promise((r) => setTimeout(r, delay));
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
    error: lastError ?? (lastStatus !== null ? `HTTP ${lastStatus}` : "unknown error"),
  };
}
