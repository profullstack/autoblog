import { P as Post } from './types-T7gU2CrZ.js';

type HeuristicConfig = {
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
type HeuristicResult = {
    pass: boolean;
    failed: string[];
    metrics: {
        wordCount: number;
        linkCount: number;
        linkDensity: number;
        imageCount: number;
    };
};
declare function scoreHeuristics(post: Post, config?: HeuristicConfig): HeuristicResult;
declare function nicheMatches(post: Post, allowedNiches: string[]): {
    pass: boolean;
    matched: string[];
};
type QualityScore = {
    ok: boolean;
    score: number | null;
    reasons: string[];
    error?: string;
    /** Which provider answered: "c0mpute", "openai" or "anthropic". */
    provider?: string;
    /** The model that answered. */
    model?: string;
};
type ScoreQualityInput = {
    post: Post;
    /** Optional niche context to bias the model's "relevance" axis. */
    niche?: string | string[];
    /**
     * Anthropic API key, used only for the paid fallback. Optional: c0mpute
     * needs no key, so leaving this out still scores.
     */
    anthropicApiKey?: string;
    /** OpenAI API key for the other paid fallback. Optional. */
    openaiApiKey?: string;
    /** Override the model on the paid fallback. */
    model?: string;
    /** Override fetch (testing). Applies to every provider. */
    fetchImpl?: typeof fetch;
    /** Override timeout in ms (default 120s - a peer node is slower than Haiku). */
    timeoutMs?: number;
    /** Pre-built router, for tests or an app that already has one. */
    ai?: AiRouterLike;
};
/** The slice of @profullstack/ai-providers' AiRouter this module uses. */
type AiRouterLike = {
    generateObject(req: Record<string, unknown>): Promise<{
        object: unknown;
        provider: string;
        model: string;
    }>;
};
declare function scoreQuality(input: ScoreQualityInput): Promise<QualityScore>;
type GateConfig = {
    /** Heuristic thresholds. Empty = use module defaults. */
    heuristics?: HeuristicConfig;
    /** Allowed niches for this receiver. Empty = accept any niche. */
    allowedNiches?: string[];
    /** Minimum quality score 0–10. Skip LLM call if undefined. */
    minQualityScore?: number;
    /**
     * Anthropic API key for the paid fallback. Optional - the gate runs on
     * c0mpute, which needs no key.
     */
    anthropicApiKey?: string;
    /** OpenAI API key for the other paid fallback. Optional. */
    openaiApiKey?: string;
    /** Fail-open behavior when the LLM call errors. Default true. */
    failOpenOnLlmError?: boolean;
};
type GateOutcome = {
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
declare function gatePost(post: Post, config: GateConfig): Promise<GateOutcome>;

export { type AiRouterLike, type GateConfig, type GateOutcome, type HeuristicConfig, type HeuristicResult, type QualityScore, type ScoreQualityInput, gatePost, nicheMatches, scoreHeuristics, scoreQuality };
