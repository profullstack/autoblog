export type SignHttpRequestOpts = {
    /** Full URL of the recipient (we need it for host + path). */
    url: string;
    method: "GET" | "POST";
    /** Body — required for POST, ignored for GET. */
    body?: string;
    /** Actor's keyId, e.g. `https://example.com/users/admin#main-key`. */
    keyId: string;
    /** PEM-encoded RSA private key. */
    privateKeyPem: string;
    /** Override `Date` header — testing only. */
    now?: () => Date;
};
export type SignedRequestHeaders = {
    host: string;
    date: string;
    digest?: string;
    signature: string;
    /** Content-Type the recipient expects for AP POSTs. */
    "content-type"?: string;
    /** Accept the recipient expects for AP GETs. */
    accept?: string;
};
export declare function signHttpRequest(opts: SignHttpRequestOpts): SignedRequestHeaders;
export type VerifyHttpSignatureInput = {
    method: string;
    url: string;
    headers: Record<string, string | string[] | undefined>;
    body: string;
    /** Resolve the actor's public key PEM given its keyId. The keyId is
     *  typically `<actor>#main-key`; the caller fetches `<actor>` and
     *  reads `publicKey.publicKeyPem` from the JSON-LD response. */
    fetchPublicKey: (keyId: string) => Promise<string | null>;
    /** Reject signatures older than this many seconds. Default 5 min. */
    toleranceSeconds?: number;
    /** Test override. */
    now?: () => Date;
};
export type VerifyHttpSignatureResult = {
    ok: true;
    keyId: string;
    signedHeaders: string[];
} | {
    ok: false;
    reason: string;
};
export declare function verifyHttpSignature(input: VerifyHttpSignatureInput): Promise<VerifyHttpSignatureResult>;
//# sourceMappingURL=httpsig.d.ts.map