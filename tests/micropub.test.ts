import { describe, it, expect } from "vitest";
import {
  parseMicropubBody,
  createMicropubHandler,
} from "../src/micropub.js";

describe("parseMicropubBody — form-urlencoded", () => {
  it("parses an h-entry with categories and a slug", () => {
    const body = new URLSearchParams({
      h: "entry",
      name: "Hello",
      content: "Hi there.",
      "mp-slug": "hello-there",
    }).toString() + "&category=seo&category=ai";
    const r = parseMicropubBody({
      contentType: "application/x-www-form-urlencoded",
      body,
    });
    expect(r.action).toBe("create");
    if (r.action === "create") {
      expect(r.entry.name).toBe("Hello");
      expect(r.entry.slug).toBe("hello-there");
      expect(r.entry.category).toEqual(["seo", "ai"]);
    }
  });

  it("recognizes a form-based delete action", () => {
    const body = new URLSearchParams({
      action: "delete",
      url: "https://example.com/blog/post",
    }).toString();
    const r = parseMicropubBody({
      contentType: "application/x-www-form-urlencoded",
      body,
    });
    expect(r.action).toBe("delete");
    if (r.action === "delete") expect(r.url).toBe("https://example.com/blog/post");
  });
});

describe("parseMicropubBody — JSON", () => {
  it("parses a microformats2 h-entry create", () => {
    const r = parseMicropubBody({
      contentType: "application/json",
      body: JSON.stringify({
        type: ["h-entry"],
        properties: {
          name: ["JSON Post"],
          content: [{ html: "<p>Body.</p>" }],
          category: ["seo"],
          "mp-slug": ["json-post"],
        },
      }),
    });
    expect(r.action).toBe("create");
    if (r.action === "create") {
      expect(r.entry.name).toBe("JSON Post");
      expect(r.entry.content).toBe("<p>Body.</p>");
      expect(r.entry.slug).toBe("json-post");
      expect(r.entry.category).toEqual(["seo"]);
    }
  });

  it("recognizes a JSON delete action", () => {
    const r = parseMicropubBody({
      contentType: "application/json",
      body: JSON.stringify({ action: "delete", url: "https://example.com/p" }),
    });
    expect(r.action).toBe("delete");
  });

  it("rejects non-h-entry create payloads", () => {
    expect(() =>
      parseMicropubBody({
        contentType: "application/json",
        body: JSON.stringify({ type: ["h-cite"], properties: {} }),
      }),
    ).toThrow();
  });
});

describe("createMicropubHandler", () => {
  it("returns 401 without bearer", async () => {
    const handler = createMicropubHandler({
      verify: () => ({ ok: true, me: "https://me" }),
      onCreate: async () => ({ url: "https://example.com/p/x" }),
    });
    const res = await handler({ method: "POST", headers: {}, body: "" });
    expect(res.status).toBe(401);
  });

  it("returns 403 when verify fails", async () => {
    const handler = createMicropubHandler({
      verify: () => ({ ok: false, reason: "expired" }),
      onCreate: async () => ({ url: "https://example.com/p/x" }),
    });
    const res = await handler({
      method: "POST",
      headers: { authorization: "Bearer t" },
      body: "h=entry&name=x&content=y",
    });
    expect(res.status).toBe(403);
  });

  it("returns 201 + Location on successful create", async () => {
    const handler = createMicropubHandler({
      verify: () => ({ ok: true, me: "https://me", scope: ["create"] }),
      onCreate: async (entry, identity) => {
        expect(entry.name).toBe("Hello");
        expect(identity.me).toBe("https://me");
        return { url: "https://example.com/blog/hello" };
      },
    });
    const res = await handler({
      method: "POST",
      headers: {
        authorization: "Bearer t",
        "content-type": "application/x-www-form-urlencoded",
      },
      body: "h=entry&name=Hello&content=Hi",
    });
    expect(res.status).toBe(201);
    expect(res.headers.location).toBe("https://example.com/blog/hello");
  });

  it("returns 204 on delete when handler is provided", async () => {
    const handler = createMicropubHandler({
      verify: () => ({ ok: true, me: "https://me" }),
      onCreate: async () => ({ url: "/x" }),
      onDelete: async (url) => {
        expect(url).toBe("https://example.com/p");
      },
    });
    const res = await handler({
      method: "POST",
      headers: { authorization: "Bearer t" },
      body: "action=delete&url=https%3A%2F%2Fexample.com%2Fp",
    });
    expect(res.status).toBe(204);
  });
});
