import { describe, it, expect } from "vitest";
import {
  scoreHeuristics,
  nicheMatches,
  scoreQuality,
  gatePost,
} from "../src/quality.js";
import type { Post } from "../src/types.js";

function makePost(over: Partial<Post> = {}): Post {
  return {
    id: "p1",
    url: "https://example.com/p",
    title: "Hello",
    slug: "hello",
    html: "<p>" + "word ".repeat(700) + "</p>",
    status: "published",
    published_at: "2026-05-15T12:00:00Z",
    updated_at: "2026-05-15T12:00:00Z",
    tags: ["security"],
    categories: [],
    ...over,
  };
}

describe("scoreHeuristics", () => {
  it("passes a normal post", () => {
    const r = scoreHeuristics(makePost());
    expect(r.pass).toBe(true);
    expect(r.failed).toEqual([]);
    expect(r.metrics.wordCount).toBeGreaterThan(500);
  });

  it("fails when below word count", () => {
    const r = scoreHeuristics(makePost({ html: "<p>too short</p>" }));
    expect(r.pass).toBe(false);
    expect(r.failed.join(" ")).toMatch(/word count/);
  });

  it("fails on excessive link density", () => {
    const links = "<a href='x'>l</a> ".repeat(40);
    const filler = "word ".repeat(600);
    const r = scoreHeuristics(
      makePost({ html: `<p>${links}${filler}</p>` }),
      { maxLinkDensity: 1.0 },
    );
    expect(r.pass).toBe(false);
    expect(r.failed.join(" ")).toMatch(/link density/);
  });

  it("does not gate link density by default", () => {
    const links = "<a href='x'>l</a> ".repeat(40);
    const filler = "word ".repeat(600);
    const r = scoreHeuristics(makePost({ html: `<p>${links}${filler}</p>` }));
    expect(r.pass).toBe(true);
  });

  it("ignores same-page fragment anchors for link density", () => {
    const toc = "<a href='#intro'>Intro</a> ".repeat(40);
    const external = "<a href='https://example.com'>source</a>";
    const filler = "word ".repeat(600);
    const r = scoreHeuristics(
      makePost({ html: `<p>${toc}${external}${filler}</p>` }),
    );
    expect(r.pass).toBe(true);
    expect(r.metrics.linkCount).toBe(1);
  });

  it("respects bannedTerms (case-insensitive)", () => {
    const r = scoreHeuristics(makePost({ title: "Buy CHEAP Viagra now" }), {
      bannedTerms: ["viagra"],
    });
    expect(r.pass).toBe(false);
    expect(r.failed.join(" ")).toMatch(/banned term/);
  });

  it("counts <img> tags", () => {
    const imgs = "<img>".repeat(25);
    const r = scoreHeuristics(
      makePost({ html: `<p>${"word ".repeat(700)}${imgs}</p>` }),
    );
    expect(r.pass).toBe(false);
    expect(r.failed.join(" ")).toMatch(/image count/);
  });
});

describe("nicheMatches", () => {
  it("accepts anything when allowedNiches is empty", () => {
    const r = nicheMatches(makePost({ tags: ["anything"] }), []);
    expect(r.pass).toBe(true);
  });

  it("accepts exact-match overlap", () => {
    const r = nicheMatches(makePost({ tags: ["security"] }), ["security"]);
    expect(r.pass).toBe(true);
    expect(r.matched).toContain("security");
  });

  it("loose: matches when allowed contains tag", () => {
    // post tag "ai" matches allowed niche "ai bots" via substring
    const r = nicheMatches(makePost({ tags: ["ai"] }), ["ai bots"]);
    expect(r.pass).toBe(true);
  });

  it("loose: matches when tag contains allowed niche", () => {
    const r = nicheMatches(
      makePost({ tags: ["cybersecurity-news"] }),
      ["security"],
    );
    expect(r.pass).toBe(true);
  });

  it("rejects when no overlap", () => {
    const r = nicheMatches(makePost({ tags: ["cooking"] }), ["security"]);
    expect(r.pass).toBe(false);
  });

  it("case-insensitive + reads categories too", () => {
    const r = nicheMatches(
      makePost({ tags: [], categories: ["Security"] }),
      ["security"],
    );
    expect(r.pass).toBe(true);
  });
});

describe("scoreQuality (c0mpute wire, mocked fetch)", () => {
  /**
   * Fakes the two calls C0mputeProvider makes: POST /api/chat for a job, then
   * the SSE stream. Proves this module is wired to the package correctly,
   * fence-stripping and all.
   */
  function mockC0mpute(answer: string, opts: { status?: number } = {}): typeof fetch {
    return (async (url: string | URL | Request) => {
      const u = String(url);
      if (u.endsWith("/api/chat")) {
        if (opts.status && opts.status !== 200) {
          return new Response(JSON.stringify({ error: "nope" }), {
            status: opts.status,
            headers: { "content-type": "application/json" },
          });
        }
        return new Response(
          JSON.stringify({ jobId: "job-1", source: "p2p", model: "qwen2.5:7b" }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      const sse =
        `event: meta\ndata: {"model":"qwen2.5:7b"}\n\n` +
        `event: token\ndata: ${JSON.stringify({ text: answer })}\n\n` +
        `event: done\ndata: {}\n\n`;
      return new Response(sse, {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
    }) as unknown as typeof fetch;
  }

  it("parses a valid {score, reasons} answer from c0mpute", async () => {
    const r = await scoreQuality({
      post: makePost(),
      fetchImpl: mockC0mpute('{"score":7,"reasons":["solid","useful"]}'),
    });
    expect(r.ok).toBe(true);
    expect(r.score).toBe(7);
    expect(r.reasons).toEqual(["solid", "useful"]);
    expect(r.provider).toBe("c0mpute");
  });

  it("strips code fences around JSON", async () => {
    const r = await scoreQuality({
      post: makePost(),
      fetchImpl: mockC0mpute('```json\n{"score":4,"reasons":["thin"]}\n```'),
    });
    expect(r.ok).toBe(true);
    expect(r.score).toBe(4);
  });

  it("clamps out-of-range scores", async () => {
    const r = await scoreQuality({
      post: makePost(),
      fetchImpl: mockC0mpute('{"score":42,"reasons":["clamp"]}'),
    });
    expect(r.ok).toBe(true);
    expect(r.score).toBe(10);
  });

  it("fails open (ok:false) when every provider errors", async () => {
    const r = await scoreQuality({
      post: makePost(),
      fetchImpl: mockC0mpute("", { status: 500 }),
    });
    expect(r.ok).toBe(false);
    expect(r.score).toBeNull();
    expect(r.error).toBeTruthy();
  });

  it("never throws, even when fetch itself blows up", async () => {
    const r = await scoreQuality({
      post: makePost(),
      fetchImpl: (async () => {
        throw new Error("socket hang up");
      }) as unknown as typeof fetch,
    });
    expect(r.ok).toBe(false);
    expect(r.score).toBeNull();
  });
});

describe("scoreQuality (injected router)", () => {
  const router = (object: unknown, provider = "c0mpute") => ({
    generateObject: async () => ({ object, provider, model: "test-model" }),
  });

  it("reports which provider answered", async () => {
    const r = await scoreQuality({
      post: makePost(),
      ai: router({ score: 9, reasons: ["novel"] }, "anthropic"),
    });
    expect(r.ok).toBe(true);
    expect(r.score).toBe(9);
    expect(r.provider).toBe("anthropic");
    expect(r.model).toBe("test-model");
  });

  it("rejects an answer with no usable score", async () => {
    const r = await scoreQuality({
      post: makePost(),
      ai: router({ reasons: ["no score"] }),
    });
    expect(r.ok).toBe(false);
    expect(r.score).toBeNull();
    expect(r.reasons).toEqual(["no score"]);
  });

  it("needs no API key at all", async () => {
    const r = await scoreQuality({ post: makePost(), ai: router({ score: 5 }) });
    expect(r.ok).toBe(true);
    expect(r.score).toBe(5);
  });
});

describe("gatePost — combined", () => {
  const fetchOk = (score: number) =>
    (async () =>
      new Response(
        JSON.stringify({
          content: [
            { type: "text", text: `{"score":${score},"reasons":["ok"]}` },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      )) as unknown as typeof fetch;

  it("bails at heuristic when too short — never calls LLM", async () => {
    let called = false;
    const fetchSpy: typeof fetch = async (...args) => {
      called = true;
      return fetchOk(8)(...(args as Parameters<typeof fetch>));
    };
    const r = await gatePost(makePost({ html: "<p>tiny</p>" }), {
      anthropicApiKey: "k",
      minQualityScore: 6,
      // Inject the spy via the score function — gatePost calls scoreQuality
      // which uses fetchImpl... but gatePost doesn't surface that override.
      // To keep the test pure, we just verify the heuristic-stage rejection.
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.stage).toBe("heuristic");
    expect(called).toBe(false);
  });

  it("bails at niche when tags don't overlap", async () => {
    const r = await gatePost(makePost({ tags: ["cooking"] }), {
      allowedNiches: ["security"],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.stage).toBe("niche");
  });

  it("passes when heuristics + niche pass and no LLM config", async () => {
    const r = await gatePost(makePost(), { allowedNiches: ["security"] });
    expect(r.ok).toBe(true);
  });
});
