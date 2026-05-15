import type { Post } from "./types.js";
export type HeuristicConfig = {
    /** Reject if word count is below this. Default 500. */
    minWordCount?: number;
    /** Reject if word count exceeds this (novella spam). Default 12000. */
    maxWordCount?: number;
    /** Reject if links per 100 words exceeds this. Default 1.0 (1%). */
    maxLinkDensity?: number;
    /** Reject if the post contains any of these (case-insensitive
     *  substring match). Empty = no check. */
    bannedTerms?: string[];
    /** Reject if more than this many <img> tags. Default 20. */
    maxImages?: number;
};
export type HeuristicResult = {
    pass: boolean;
    failed: string[];
    metrics: {
        wordCount: number;
        linkCount: number;
        linkDensity: number;
        imageCount: number;
    };
};
export declare function scoreHeuristics(post: Post, config?: HeuristicConfig): HeuristicResult;
export declare function nicheMatches(post: Post, allowedNiches: string[]): {
    pass: boolean;
    matched: string[];
};
export type QualityScore = {
    ok: boolean;
    score: number | null;
    reasons: string[];
    error?: string;
};
export type ScoreQualityInput = {
    post: Post;
    /** Optional niche context to bias the model's "relevance" axis. */
    niche?: string | string[];
    /** Anthropic API key. */
    anthropicApiKey: string;
    /** Override model — defaults to claude-haiku-4-5-20251001. */
    model?: string;
    /** Override fetch (testing). */
    fetchImpl?: typeof fetch;
    /** Override timeout in ms (default 15s). */
    timeoutMs?: number;
};
export declare function scoreQuality(input: ScoreQualityInput): Promise<QualityScore>;
export type GateConfig = {
    /** Heuristic thresholds. Empty = use module defaults. */
    heuristics?: HeuristicConfig;
    /** Allowed niches for this receiver. Empty = accept any niche. */
    allowedNiches?: string[];
    /** Minimum quality score 0–10. Skip LLM call if undefined. */
    minQualityScore?: number;
    /** Anthropic API key for the LLM gate. Required iff minQualityScore is set. */
    anthropicApiKey?: string;
    /** Fail-open behavior when the LLM call errors. Default true. */
    failOpenOnLlmError?: boolean;
};
export type GateOutcome = {
    ok: true;
    metrics: HeuristicResult["metrics"];
    quality?: QualityScore;
} | {
    ok: false;
    stage: "heuristic" | "niche" | "quality";
    reasons: string[];
    metrics?: HeuristicResult["metrics"];
    quality?: QualityScore;
};
export declare function gatePost(post: Post, config: GateConfig): Promise<GateOutcome>;
//# sourceMappingURL=quality.d.ts.map