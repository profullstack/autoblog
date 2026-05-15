export type DeliverOpts = {
    /** Actor URL — the keyId becomes `<actorId>#main-key`. */
    actorId: string;
    /** Actor's PEM private key. */
    privateKeyPem: string;
    /** Follower inbox URLs. */
    inboxUrls: string[];
    /** The activity (Create/Accept/etc.) to deliver. */
    activity: unknown;
    /** Per-request timeout. Default 8s. */
    timeoutMs?: number;
    /** Override fetch — testing. */
    fetchImpl?: typeof fetch;
};
export type DeliverResult = {
    delivered: number;
    failed: Array<{
        url: string;
        status: number | null;
        error?: string;
    }>;
};
export declare function deliverToInboxes(opts: DeliverOpts): Promise<DeliverResult>;
//# sourceMappingURL=deliver.d.ts.map