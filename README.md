# @profullstack/autoblog

The autoblog publishing/receiving SDK. Three protocols, one package.

## What's in here

| Module | Standard | What it does |
|---|---|---|
| `@profullstack/autoblog` | [CloudEvents 1.0][ce] + [Standard Webhooks][sw] | Normalized post-published events. Build, sign, send, verify, parse. The default channel for AI-writer → blog publishing. |
| `@profullstack/autoblog/micropub` | [W3C Micropub][mp] | Inbound publishing API. Mount the handler at your `/micropub` endpoint and accept posts from Quill, Indigenous, Omnibear, etc. |
| `@profullstack/autoblog/activitypub` | [W3C ActivityPub][ap] | Protocol surface for federating your blog: Actor + WebFinger builders, ActivityStreams Note/Article shapes, HTTP Signatures sign + verify, signed-POST fan-out. |

[ce]: https://github.com/cloudevents/spec/blob/main/cloudevents/spec.md
[sw]: https://www.standardwebhooks.com/
[mp]: https://www.w3.org/TR/micropub/
[ap]: https://www.w3.org/TR/activitypub/

## Install

```bash
npm i @profullstack/autoblog
# or
pnpm add @profullstack/autoblog
```

Node 18+. ESM only.

## Sender — emit a post-published event

```ts
import { buildEvent, sendWebhook, type Post } from "@profullstack/autoblog";

const post: Post = {
  id: "p_123",
  url: "https://crawlproof.com/blog/why-llms-txt",
  title: "Why your llms.txt matters",
  slug: "why-llms-txt",
  html: "<p>…</p>",
  status: "published",
  published_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  tags: ["seo", "ai bots"],
  categories: [],
};

const event = buildEvent(post, { source: "https://crawlproof.com" });
const result = await sendWebhook("https://receiver.example/api/webhook", event, {
  secret: process.env.WEBHOOK_SECRET!,
});
console.log(result.ok ? "delivered" : `failed (${result.status})`);
```

Sends `Authorization: Bearer …` plus the three Standard Webhooks headers:

```
webhook-id:        <event id>
webhook-timestamp: <unix seconds>
webhook-signature: v1,<base64 HMAC-SHA256 of "${id}.${timestamp}.${body}">
content-type:      application/cloudevents+json
```

## Receiver — verify and parse

```ts
import { verifyAndParse } from "@profullstack/autoblog";

export async function POST(req: Request) {
  const body = await req.text(); // raw bytes — needed for signature
  const r = verifyAndParse({
    headers: Object.fromEntries(req.headers),
    body,
    opts: { secret: process.env.WEBHOOK_SECRET! },
  });
  if (!r.ok) return new Response(r.reason, { status: r.status });

  await savePost(r.post); // your CMS / DB
  return new Response(null, { status: 200 });
}
```

`verifyAndParse` validates the bearer (constant-time), the Standard Webhooks signature, and the envelope shape. Failure modes split cleanly into 400 (bad body) and 401 (auth).

## Micropub server

```ts
import { createMicropubHandler } from "@profullstack/autoblog/micropub";

const handler = createMicropubHandler({
  // Validate the IndieAuth bearer however you like — local table,
  // remote validator, your own /token endpoint.
  verify: async (token) => {
    const row = await db.tokens.find({ token });
    return row ? { ok: true, me: row.profileUrl, scope: row.scopes } : { ok: false, reason: "unknown token" };
  },
  onCreate: async (entry, identity) => {
    const slug = entry.slug ?? slugify(entry.name ?? "untitled");
    const url = `https://example.com/blog/${slug}`;
    await db.posts.insert({ url, title: entry.name, html: entry.content, tags: entry.category });
    return { url };
  },
  onDelete: async (url) => { await db.posts.delete({ url }); },
});

// Wire into your framework — example (Next.js route handler):
export async function POST(req: Request) {
  const body = await req.text();
  const res = await handler({
    method: "POST",
    headers: Object.fromEntries(req.headers),
    body,
  });
  return new Response(res.body, { status: res.status, headers: res.headers });
}
```

## ActivityPub federation

```ts
import {
  generateActorKeypair,
  buildActor,
  buildWebFinger,
  buildNote,
  buildCreateActivity,
  deliverToInboxes,
  verifyHttpSignature,
} from "@profullstack/autoblog/activitypub";

// One-time: create + persist your actor key.
const { publicKeyPem, privateKeyPem } = generateActorKeypair();
// Store privateKeyPem encrypted; publicKeyPem goes in the Actor object.

// /.well-known/webfinger?resource=acct:admin@example.com
const finger = buildWebFinger({
  username: "admin",
  host: "example.com",
  actorUrl: "https://example.com/users/admin",
});

// /users/admin
const actor = buildActor({
  id: "https://example.com/users/admin",
  preferredUsername: "admin",
  name: "Example Blog",
  publicKeyPem,
});

// When a post lands → build + sign + deliver to followers' inboxes.
const note = buildNote(post, { actorId: actor.id });
const activity = buildCreateActivity({ actorId: actor.id, note });
await deliverToInboxes({
  actorId: actor.id,
  privateKeyPem,
  inboxUrls: followerInboxes, // from your followers table
  activity,
});

// Inbox verification on POST /users/admin/inbox:
const r = await verifyHttpSignature({
  method: "POST",
  url: "https://example.com/users/admin/inbox",
  headers,
  body,
  fetchPublicKey: async (keyId) => {
    // Strip the fragment, fetch the actor JSON, return publicKey.publicKeyPem
    const actorUrl = keyId.split("#")[0];
    const res = await fetch(actorUrl, {
      headers: { accept: "application/activity+json" },
    });
    if (!res.ok) return null;
    const a = await res.json();
    return a?.publicKey?.publicKeyPem ?? null;
  },
});
```

**What the SDK doesn't do**: store followers, run an outbox queue, or remember which followers you've already delivered to. Those are persistence concerns and they're the host app's job.

## Versioning

0.x: API may change between minor versions. After 1.0, semver.

## License

MIT
