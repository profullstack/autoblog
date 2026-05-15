import type { PostPublishedEvent, Post } from "./types.js";
export type ReceivedHeaders = Record<string, string | string[] | undefined>;
export type ParseOpts = {
    /** Required bearer/HMAC secret (the same value the sender holds). */
    secret: string;
    /**
     * If provided, require the bearer to match this value byte-for-byte
     * (in addition to verifying the signature). Useful when the receiver
     * stores a different value as the bearer than as the HMAC key, but
     * normally both are the same — leave undefined to skip the extra
     * check.
     */
    expectedBearer?: string;
    /** Signature timestamp tolerance, default 5 minutes. */
    toleranceSeconds?: number;
};
export type ParseFailure = {
    ok: false;
    status: 400 | 401;
    reason: string;
};
export type ParseSuccess = {
    ok: true;
    event: PostPublishedEvent;
    post: Post;
};
export type ParseResult = ParseSuccess | ParseFailure;
/**
 * Verify auth + signature and parse the body. The caller passes the
 * raw request text (NOT `await req.json()` — the signature is over the
 * bytes as received).
 */
export declare function verifyAndParse(input: {
    headers: ReceivedHeaders;
    body: string;
    opts: ParseOpts;
}): ParseResult;
//# sourceMappingURL=receiver.d.ts.map