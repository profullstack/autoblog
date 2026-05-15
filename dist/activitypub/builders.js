// ActivityStreams object builders. Pure functions — produce JSON-LD
// shapes from your normalized blog post + actor identity. The host app
// decides where to publish them (outbox JSON endpoint, follower
// inboxes via signed POSTs).
import crypto from "node:crypto";
const CONTEXT_AP = "https://www.w3.org/ns/activitystreams";
const CONTEXT_SEC = "https://w3id.org/security/v1";
export function buildActor(opts) {
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
export function buildWebFinger(opts) {
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
function noteType(post) {
    if (post.title && post.html && post.html.length > 500)
        return "Article";
    return "Note";
}
export function buildNote(post, opts) {
    const tags = post.tags.map((t) => ({
        type: "Hashtag",
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
export function buildCreateActivity(input) {
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
export function buildAcceptFollow(input) {
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
export function generateActorKeypair() {
    const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", {
        modulusLength: 2048,
    });
    return {
        publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
        privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    };
}
//# sourceMappingURL=builders.js.map