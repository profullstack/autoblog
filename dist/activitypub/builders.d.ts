import type { ActorObject, CreateActivity, NoteObject, WebFingerResponse, AcceptActivity, FollowActivity } from "./types.js";
import type { Post } from "../types.js";
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
export declare function buildActor(opts: BuildActorOpts): ActorObject;
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
export declare function buildWebFinger(opts: BuildWebFingerOpts): WebFingerResponse;
export type BuildNoteOpts = {
    /** Actor URL (who is publishing). */
    actorId: string;
    /** Hashtag base URL — e.g. `https://example.com/tags/`. Defaults to
     *  the host's `/tags/` if your actor lives there. */
    hashtagBase?: string;
    /** Override the Note id. Defaults to `${post.url}#note`. */
    id?: string;
};
export declare function buildNote(post: Post, opts: BuildNoteOpts): NoteObject;
export declare function buildCreateActivity(input: {
    actorId: string;
    note: NoteObject;
    id?: string;
}): CreateActivity;
export declare function buildAcceptFollow(input: {
    actorId: string;
    follow: FollowActivity;
    id?: string;
}): AcceptActivity;
export declare function generateActorKeypair(): {
    publicKeyPem: string;
    privateKeyPem: string;
};
//# sourceMappingURL=builders.d.ts.map