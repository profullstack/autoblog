import type { Post, PostPublishedEvent } from "./types.js";
export type BuildEventOpts = {
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
export declare function buildEvent(post: Post, opts: BuildEventOpts): PostPublishedEvent;
export type SendWebhookOpts = {
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
export type DeliveryResult = {
    ok: boolean;
    status: number | null;
    attempts: number;
    error?: string;
};
export declare function sendWebhook(url: string, event: PostPublishedEvent, opts: SendWebhookOpts): Promise<DeliveryResult>;
//# sourceMappingURL=sender.d.ts.map