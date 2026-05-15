import { describe, it, expect } from "vitest";
import { buildEvent, sendWebhook } from "../src/sender.js";
import { verifyAndParse } from "../src/receiver.js";
import type { Post } from "../src/types.js";

const samplePost: Post = {
  id: "p_1",
  url: "https://example.com/blog/hello",
  title: "Hello",
  slug: "hello",
  html: "<p>Hi.</p>",
  status: "published",
  published_at: "2026-05-15T12:00:00.000Z",
  updated_at: "2026-05-15T12:00:00.000Z",
  tags: ["seo"],
  categories: [],
};

describe("buildEvent", () => {
  it("derives a reverse-DNS event type from the source", () => {
    const e = buildEvent(samplePost, { source: "https://crawlproof.com" });
    expect(e.type).toBe("com.crawlproof.post.published.v1");
    expect(e.source).toBe("https://crawlproof.com");
    expect(e.subject).toBe("post:p_1");
    expect(e.data.post.title).toBe("Hello");
    expect(e.specversion).toBe("1.0");
  });
  it("honours an explicit type override", () => {
    const e = buildEvent(samplePost, {
      source: "https://example.com",
      type: "com.example.custom.v2",
    });
    expect(e.type).toBe("com.example.custom.v2");
  });
});

describe("sendWebhook → verifyAndParse round-trip", () => {
  it("a valid delivery passes verification on the other side", async () => {
    const event = buildEvent(samplePost, { source: "https://crawlproof.com" });
    const secret = "shared-bearer";
    let receivedHeaders: Record<string, string> = {};
    let receivedBody = "";

    const fakeFetch: typeof fetch = async (_url, init) => {
      const initT = init as RequestInit & { body?: string };
      receivedHeaders = initT.headers as Record<string, string>;
      receivedBody = String(initT.body ?? "");
      return new Response("{}", { status: 200 });
    };

    const result = await sendWebhook("https://receiver.local/wh", event, {
      secret,
      fetchImpl: fakeFetch,
      retryDelaysMs: [0],
    });
    expect(result.ok).toBe(true);
    expect(result.status).toBe(200);

    const parsed = verifyAndParse({
      headers: receivedHeaders,
      body: receivedBody,
      opts: { secret },
    });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.post.id).toBe("p_1");
      expect(parsed.event.type).toBe("com.crawlproof.post.published.v1");
    }
  });

  it("retries on 5xx + reports attempts", async () => {
    const event = buildEvent(samplePost, { source: "https://crawlproof.com" });
    let calls = 0;
    const fakeFetch: typeof fetch = async () => {
      calls++;
      if (calls < 2) return new Response("err", { status: 503 });
      return new Response("{}", { status: 200 });
    };
    const result = await sendWebhook("https://receiver.local/wh", event, {
      secret: "s",
      fetchImpl: fakeFetch,
      retryDelaysMs: [0, 0],
    });
    expect(result.ok).toBe(true);
    expect(result.attempts).toBe(2);
  });

  it("does not retry on 4xx", async () => {
    const event = buildEvent(samplePost, { source: "https://crawlproof.com" });
    let calls = 0;
    const fakeFetch: typeof fetch = async () => {
      calls++;
      return new Response("nope", { status: 401 });
    };
    const result = await sendWebhook("https://receiver.local/wh", event, {
      secret: "s",
      fetchImpl: fakeFetch,
      retryDelaysMs: [0, 0, 0],
    });
    expect(result.ok).toBe(false);
    expect(result.status).toBe(401);
    expect(calls).toBe(1);
  });
});

describe("verifyAndParse — bad inputs", () => {
  it("401s on wrong bearer", () => {
    const event = buildEvent(samplePost, { source: "https://crawlproof.com" });
    // Build the canonical wire shape manually with one secret and pass
    // a different secret in to ensure both bearer + signature checks
    // would fail.
    const r = verifyAndParse({
      headers: {
        authorization: "Bearer wrong",
        "webhook-id": event.id,
        "webhook-timestamp": String(Math.floor(Date.now() / 1000)),
        "webhook-signature": "v1,abc",
      },
      body: JSON.stringify(event),
      opts: { secret: "real" },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(401);
  });

  it("400s on body that isn't a valid envelope", () => {
    const r = verifyAndParse({
      headers: {
        authorization: "Bearer s",
        "webhook-id": "x",
        "webhook-timestamp": String(Math.floor(Date.now() / 1000)),
        "webhook-signature": "v1,...",
      },
      body: '{"hello":"world"}',
      opts: { secret: "s" },
    });
    expect(r.ok).toBe(false);
  });
});
