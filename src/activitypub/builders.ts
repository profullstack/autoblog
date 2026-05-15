// ActivityStreams object builders. Pure functions — produce JSON-LD
// shapes from your normalized blog post + actor identity. The host app
// decides where to publish them (outbox JSON endpoint, follower
// inboxes via signed POSTs).

import crypto from "node:crypto";
import type {
  ActorObject,
  CreateActivity,
  NoteObject,
  WebFingerResponse,
  AcceptActivity,
  FollowActivity,
} from "./types.js";
import type { Post } from "../types.js";

const CONTEXT_AP = "https://www.w3.org/ns/activitystreams";
const CONTEXT_SEC = "https://w3id.org/security/v1";

export type BuildActorOpts = {
  /** Public-facing actor URL, e.g. `https://example.com/users/admin`. */
  id: string;
  /** Local username — the `acct:<preferredUsername>@<host>` part. */
  preferredUsername: string;
  name?: string;
  summary?: string;
  /** PEM-encoded RSA public key. Must match the private key the host
   *  uses to sign outgoing requests. */
  publicKeyPem: string;
  /** Avatar URL. */
  iconUrl?: string;
  /** Profile URL (defaults to id). */
  url?: string;
  /** Type — defaults to Service for autoblog bots. */
  type?: ActorObject["type"];
};

export function buildActor(opts: BuildActorOpts): ActorObject {
  const id = opts.id;
  return {
    "@context": [CONTEXT_AP, CONTEXT_SEC],
    type: opts.type ?? "Service",
    id,
    preferredUsername: opts.preferredUsername,
    name: opts.name,
    summary: opts.summary,
    inbox: `${id}/inbox`,
    outbox: `${id}/outbox`,
    followers: `${id}/followers`,
    following: `${id}/following`,
    publicKey: {
      id: `${id}#main-key`,
      owner: id,
      publicKeyPem: opts.publicKeyPem,
    },
    icon: opts.iconUrl ? { type: "Image", url: opts.iconUrl } : undefined,
    url: opts.url ?? id,
  };
}

export type BuildWebFingerOpts = {
  /** Local username (no @). */
  username: string;
  /** Host (e.g. `example.com`). */
  host: string;
  /** Actor URL. */
  actorUrl: string;
  /** Profile URL (often the same as actor). */
  profileUrl?: string;
};

export function buildWebFinger(opts: BuildWebFingerOpts): WebFingerResponse {
  const acct = `acct:${opts.username}@${opts.host}`;
  const profile = opts.profileUrl ?? opts.actorUrl;
  return {
    subject: acct,
    aliases: [opts.actorUrl, profile],
    links: [
      { rel: "self", type: "application/activity+json", href: opts.actorUrl },
      { rel: "http://webfinger.net/rel/profile-page", type: "text/html", href: profile },
    ],
  };
}

// Decide Note vs Article — long-form gets Article so Mastodon renders
// the title and a "Read more"; short posts feel native as Notes.
function noteType(post: Post): "Note" | "Article" {
  if (post.title && post.html && post.html.length > 500) return "Article";
  return "Note";
}

export type BuildNoteOpts = {
  /** Actor URL (who is publishing). */
  actorId: string;
  /** Hashtag base URL — e.g. `https://example.com/tags/`. Defaults to
   *  the host's `/tags/` if your actor lives there. */
  hashtagBase?: string;
  /** Override the Note id. Defaults to `${post.url}#note`. */
  id?: string;
};

export function buildNote(post: Post, opts: BuildNoteOpts): NoteObject {
  const tags = post.tags.map((t) => ({
    type: "Hashtag" as const,
    name: `#${t.replace(/\s+/g, "")}`,
    href: opts.hashtagBase ? `${opts.hashtagBase}${encodeURIComponent(t)}` : undefined,
  }));
  return {
    "@context": [CONTEXT_AP],
    type: noteType(post),
    id: opts.id ?? `${post.url}#note`,
    attributedTo: opts.actorId,
    to: ["https://www.w3.org/ns/activitystreams#Public"],
    cc: [`${opts.actorId}/followers`],
    content: post.html,
    summary: post.title || post.excerpt || undefined,
    published: post.published_at,
    url: post.url,
    tag: tags.length > 0 ? tags : undefined,
    attachment: post.featured_image
      ? [
          {
            type: "Image",
            url: post.featured_image.url,
            name: post.featured_image.alt,
          },
        ]
      : undefined,
    source: post.markdown
      ? { content: post.markdown, mediaType: "text/markdown" }
      : undefined,
  };
}

export function buildCreateActivity(input: {
  actorId: string;
  note: NoteObject;
  id?: string;
}): CreateActivity {
  return {
    "@context": [CONTEXT_AP],
    type: "Create",
    id: input.id ?? `${input.note.id}/activity`,
    actor: input.actorId,
    to: input.note.to,
    cc: input.note.cc,
    published: input.note.published,
    object: input.note,
  };
}

export function buildAcceptFollow(input: {
  actorId: string;
  follow: FollowActivity;
  id?: string;
}): AcceptActivity {
  return {
    "@context": [CONTEXT_AP],
    type: "Accept",
    id: input.id ?? `${input.actorId}/accepts/${encodeURIComponent(input.follow.id)}`,
    actor: input.actorId,
    object: input.follow,
  };
}

// RSA-2048 keypair generator — convenience for first-time actor setup.
// Store the PEM private key encrypted at rest; the public key goes in
// the Actor object.
export function generateActorKeypair(): { publicKeyPem: string; privateKeyPem: string } {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
  });
  return {
    publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
    privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  };
}
