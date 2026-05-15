import { S as SignedHeaders, P as Post, b as PostPublishedEvent } from './types-Bky-agAM.cjs';
export { A as Author, C as CloudEvent, E as EVENT_TYPES, a as EventType, F as FeaturedImage, c as PostStatus } from './types-Bky-agAM.cjs';

type SignInput = {
    id: string;
    timestamp: number;
    body: string;
    secret: string;
};
declare function signRequest(input: SignInput): SignedHeaders;
type VerifyInput = {
    headers: Record<string, string | string[] | undefined>;
    body: string;
    secret: string;
    toleranceSeconds?: number;
    /** Override the "now" used for timestamp tolerance — testing only. */
    now?: () => number;
};
type VerifyResult = {
    ok: true;
    id: string;
    timestamp: number;
} | {
    ok: false;
    reason: string;
};
declare function verifySignature(input: VerifyInput): VerifyResult;

type BuildEventOpts = {
    /** Producer URL — e.g. "https://crawlproof.com". Used as the
     *  CloudEvents `source` and to namespace the event type. */
    source: string;
    /** Event type. Defaults to `post.published.v1` namespaced under the
     *  source hostname's reverse DNS (`com.example.post.published.v1`). */
    type?: string;
    /** Stable event ID; one is generated if omitted. */
    eventId?: string;
    /** Override CloudEvents `time` — testing only. */
    time?: string;
};
declare function buildEvent(post: Post, opts: BuildEventOpts): PostPublishedEvent;
type SendWebhookOpts = {
    /** Shared secret used as HMAC key. Same value the receiver has. */
    secret: string;
    /** Retry delays in ms. Defaults to [0, 10s, 60s]. Set to [0] to disable. */
    retryDelaysMs?: number[];
    /** Per-request timeout. Default 10s. */
    timeoutMs?: number;
    /** Override User-Agent header. */
    userAgent?: string;
    /** Override the fetch implementation — testing or custom transport. */
    fetchImpl?: typeof fetch;
};
type DeliveryResult = {
    ok: boolean;
    status: number | null;
    attempts: number;
    error?: string;
};
declare function sendWebhook(url: string, event: PostPublishedEvent, opts: SendWebhookOpts): Promise<DeliveryResult>;

type ReceivedHeaders = Record<string, string | string[] | undefined>;
type ParseOpts = {
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
type ParseFailure = {
    ok: false;
    status: 400 | 401;
    reason: string;
};
type ParseSuccess = {
    ok: true;
    event: PostPublishedEvent;
    post: Post;
};
type ParseResult = ParseSuccess | ParseFailure;
/**
 * Verify auth + signature and parse the body. The caller passes the
 * raw request text (NOT `await req.json()` — the signature is over the
 * bytes as received).
 */
declare function verifyAndParse(input: {
    headers: ReceivedHeaders;
    body: string;
    opts: ParseOpts;
}): ParseResult;

export { type BuildEventOpts, type DeliveryResult, type ParseFailure, type ParseOpts, type ParseResult, type ParseSuccess, Post, PostPublishedEvent, type ReceivedHeaders, type SendWebhookOpts, type SignInput, SignedHeaders, type VerifyInput, type VerifyResult, buildEvent, sendWebhook, signRequest, verifyAndParse, verifySignature };
