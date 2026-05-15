export type ActorObject = {
    "@context": Array<string | Record<string, unknown>>;
    type: "Person" | "Service" | "Application" | "Organization";
    id: string;
    preferredUsername: string;
    name?: string;
    summary?: string;
    inbox: string;
    outbox: string;
    followers?: string;
    following?: string;
    publicKey: {
        id: string;
        owner: string;
        publicKeyPem: string;
    };
    icon?: {
        type: "Image";
        url: string;
        mediaType?: string;
    };
    url?: string;
};
export type NoteObject = {
    "@context": Array<string | Record<string, unknown>>;
    type: "Note" | "Article";
    id: string;
    attributedTo: string;
    to: string[];
    cc?: string[];
    content: string;
    summary?: string;
    published: string;
    url?: string;
    tag?: Array<{
        type: "Hashtag";
        name: string;
        href?: string;
    }>;
    attachment?: Array<{
        type: "Image" | "Document";
        url: string;
        mediaType?: string;
        name?: string;
    }>;
    inReplyTo?: string;
    source?: {
        content: string;
        mediaType: string;
    };
};
export type CreateActivity = {
    "@context": Array<string | Record<string, unknown>>;
    type: "Create";
    id: string;
    actor: string;
    to: string[];
    cc?: string[];
    published: string;
    object: NoteObject;
};
export type FollowActivity = {
    "@context": Array<string | Record<string, unknown>>;
    type: "Follow";
    id: string;
    actor: string;
    object: string;
};
export type AcceptActivity = {
    "@context": Array<string | Record<string, unknown>>;
    type: "Accept";
    id: string;
    actor: string;
    object: FollowActivity | string;
};
export type UndoActivity = {
    "@context": Array<string | Record<string, unknown>>;
    type: "Undo";
    id: string;
    actor: string;
    object: FollowActivity | string;
};
export type WebFingerResponse = {
    subject: string;
    aliases?: string[];
    links: Array<{
        rel: string;
        type?: string;
        href?: string;
        template?: string;
    }>;
};
//# sourceMappingURL=types.d.ts.map