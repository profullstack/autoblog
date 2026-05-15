export type MicropubEntry = {
    type: "h-entry";
    name?: string;
    content?: string;
    summary?: string;
    category?: string[];
    published?: string;
    slug?: string;
    status?: "published" | "draft";
    photo?: string[];
    extras: Record<string, unknown>;
};
export type MicropubAction = "create" | "update" | "delete" | "undelete";
export type MicropubRequest = {
    action: "create";
    entry: MicropubEntry;
} | {
    action: "update";
    url: string;
    replace?: Record<string, unknown[]>;
    add?: Record<string, unknown[]>;
    delete?: string[] | Record<string, unknown[]>;
} | {
    action: "delete";
    url: string;
} | {
    action: "undelete";
    url: string;
};
export declare function parseMicropubBody(input: {
    contentType: string | null | undefined;
    body: string;
}): MicropubRequest;
export type MicropubVerifyResult = {
    ok: true;
    me: string;
    scope?: string[];
} | {
    ok: false;
    reason: string;
};
export type MicropubCreateResult = {
    url: string;
};
export type MicropubHandlerOpts = {
    /** Verify the bearer (typically an IndieAuth token). */
    verify: (token: string) => Promise<MicropubVerifyResult> | MicropubVerifyResult;
    /** Persist a created entry. Must return the post's public URL. */
    onCreate: (entry: MicropubEntry, identity: {
        me: string;
        scope?: string[];
    }) => Promise<MicropubCreateResult>;
    /** Optional update handler. */
    onUpdate?: (req: Extract<MicropubRequest, {
        action: "update";
    }>) => Promise<void>;
    /** Optional delete handler. */
    onDelete?: (url: string) => Promise<void>;
    /** Optional undelete handler. */
    onUndelete?: (url: string) => Promise<void>;
};
export type HandlerResponse = {
    status: number;
    headers: Record<string, string>;
    body: string;
};
export declare function createMicropubHandler(opts: MicropubHandlerOpts): (req: {
    method: string;
    headers: Record<string, string | string[] | undefined>;
    body: string;
}) => Promise<HandlerResponse>;
//# sourceMappingURL=micropub.d.ts.map