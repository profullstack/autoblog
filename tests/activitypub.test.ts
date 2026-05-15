import { describe, it, expect } from "vitest";
import {
  buildActor,
  buildWebFinger,
  buildNote,
  buildCreateActivity,
  generateActorKeypair,
} from "../src/activitypub/builders.js";
import { signHttpRequest, verifyHttpSignature } from "../src/activitypub/httpsig.js";
import type { Post } from "../src/types.js";

const post: Post = {
  id: "p_1",
  url: "https://example.com/blog/hello",
  title: "Hello",
  slug: "hello",
  html: "<p>Hi there.</p>",
  status: "published",
  published_at: "2026-05-15T12:00:00.000Z",
  updated_at: "2026-05-15T12:00:00.000Z",
  tags: ["seo", "ai bots"],
  categories: [],
};

describe("buildActor", () => {
  it("emits the AP + Security contexts and key pointers", () => {
    const a = buildActor({
      id: "https://example.com/users/admin",
      preferredUsername: "admin",
      name: "Admin",
      publicKeyPem: "-----BEGIN PUBLIC KEY-----...\n-----END PUBLIC KEY-----",
    });
    expect(a.type).toBe("Service");
    expect(a["@context"]).toContain("https://www.w3.org/ns/activitystreams");
    expect(a["@context"]).toContain("https://w3id.org/security/v1");
    expect(a.inbox).toBe("https://example.com/users/admin/inbox");
    expect(a.publicKey.id).toBe("https://example.com/users/admin#main-key");
    expect(a.publicKey.owner).toBe("https://example.com/users/admin");
  });
});

describe("buildWebFinger", () => {
  it("constructs an acct: subject and self link", () => {
    const r = buildWebFinger({
      username: "admin",
      host: "example.com",
      actorUrl: "https://example.com/users/admin",
    });
    expect(r.subject).toBe("acct:admin@example.com");
    expect(r.links.some((l) => l.rel === "self" && l.type === "application/activity+json")).toBe(true);
  });
});

describe("buildNote / buildCreateActivity", () => {
  it("uses Article for long-form posts and Note for short", () => {
    const longPost: Post = { ...post, html: "x".repeat(600) };
    const n1 = buildNote(longPost, { actorId: "https://example.com/users/admin" });
    expect(n1.type).toBe("Article");

    const shortPost: Post = { ...post, html: "<p>short</p>" };
    const n2 = buildNote(shortPost, { actorId: "https://example.com/users/admin" });
    expect(n2.type).toBe("Note");
  });

  it("addresses public + actor's followers", () => {
    const n = buildNote(post, { actorId: "https://example.com/users/admin" });
    expect(n.to).toContain("https://www.w3.org/ns/activitystreams#Public");
    expect(n.cc).toEqual(["https://example.com/users/admin/followers"]);
  });

  it("emits hashtags from post.tags", () => {
    const n = buildNote(post, {
      actorId: "https://example.com/users/admin",
      hashtagBase: "https://example.com/tags/",
    });
    expect(n.tag?.[0]?.type).toBe("Hashtag");
    expect(n.tag?.[0]?.name).toBe("#seo");
    expect(n.tag?.[1]?.name).toBe("#aibots"); // whitespace stripped
  });

  it("wraps a Note in a Create activity", () => {
    const n = buildNote(post, { actorId: "https://example.com/users/admin" });
    const c = buildCreateActivity({
      actorId: "https://example.com/users/admin",
      note: n,
    });
    expect(c.type).toBe("Create");
    expect(c.actor).toBe("https://example.com/users/admin");
    expect(c.object.id).toBe(n.id);
  });
});

describe("HTTP Signatures sign + verify", () => {
  const { publicKeyPem, privateKeyPem } = generateActorKeypair();
  const keyId = "https://example.com/users/admin#main-key";

  it("a signed POST verifies against the matching public key", async () => {
    const body = '{"type":"Create","object":{}}';
    const now = new Date("2026-05-15T12:00:00.000Z");
    const headers = signHttpRequest({
      url: "https://remote.example/users/foo/inbox",
      method: "POST",
      body,
      keyId,
      privateKeyPem,
      now: () => now,
    });

    const result = await verifyHttpSignature({
      method: "POST",
      url: "https://remote.example/users/foo/inbox",
      headers: headers as unknown as Record<string, string>,
      body,
      fetchPublicKey: async () => publicKeyPem,
      now: () => now,
    });
    expect(result.ok).toBe(true);
  });

  it("rejects tampered bodies (digest mismatch)", async () => {
    const body = '{"type":"Create"}';
    const now = new Date("2026-05-15T12:00:00.000Z");
    const headers = signHttpRequest({
      url: "https://r.example/inbox",
      method: "POST",
      body,
      keyId,
      privateKeyPem,
      now: () => now,
    });
    const result = await verifyHttpSignature({
      method: "POST",
      url: "https://r.example/inbox",
      headers: headers as unknown as Record<string, string>,
      body: body + " ",
      fetchPublicKey: async () => publicKeyPem,
      now: () => now,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/digest/);
  });

  it("rejects an out-of-tolerance date", async () => {
    const body = "{}";
    const signedAt = new Date("2026-05-15T12:00:00.000Z");
    const checkedAt = new Date("2026-05-15T13:00:00.000Z"); // 1 hour later
    const headers = signHttpRequest({
      url: "https://r.example/inbox",
      method: "POST",
      body,
      keyId,
      privateKeyPem,
      now: () => signedAt,
    });
    const result = await verifyHttpSignature({
      method: "POST",
      url: "https://r.example/inbox",
      headers: headers as unknown as Record<string, string>,
      body,
      fetchPublicKey: async () => publicKeyPem,
      now: () => checkedAt,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/tolerance/);
  });

  it("rejects when the public key resolver returns null", async () => {
    const body = "{}";
    const now = new Date("2026-05-15T12:00:00.000Z");
    const headers = signHttpRequest({
      url: "https://r.example/inbox",
      method: "POST",
      body,
      keyId,
      privateKeyPem,
      now: () => now,
    });
    const result = await verifyHttpSignature({
      method: "POST",
      url: "https://r.example/inbox",
      headers: headers as unknown as Record<string, string>,
      body,
      fetchPublicKey: async () => null,
      now: () => now,
    });
    expect(result.ok).toBe(false);
  });
});
