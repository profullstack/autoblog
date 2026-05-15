import type { SignedHeaders } from "./types.js";
export type SignInput = {
    id: string;
    timestamp: number;
    body: string;
    secret: string;
};
export declare function signRequest(input: SignInput): SignedHeaders;
export type VerifyInput = {
    headers: Record<string, string | string[] | undefined>;
    body: string;
    secret: string;
    toleranceSeconds?: number;
    /** Override the "now" used for timestamp tolerance — testing only. */
    now?: () => number;
};
export type VerifyResult = {
    ok: true;
    id: string;
    timestamp: number;
} | {
    ok: false;
    reason: string;
};
export declare function verifySignature(input: VerifyInput): VerifyResult;
//# sourceMappingURL=sign.d.ts.map