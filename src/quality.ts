// Network gate for inbound posts: heuristic + niche + LLM quality.
//
// Receivers in a multi-tenant publishing network can't accept anything
// pushed at them — they need a quality bar AND a niche match, or the
// network turns into a spam swamp. This module bundles all three
// gates; receivers wire them up between verifyAndParse and the
// blog_posts upsert.
//
//   verifyAndParse  →  scoreHeuristics  →  nicheMatches  →  scoreQuality
//          ↓ ok            ↓ pass            ↓ overlap        ↓ ≥ threshold
//        next             next               next              publish

import { createAiProviders } from "@profullstack/ai-providers";
import type { Post } from "./types.js";

// ============================================================
// Heuristic gates — deterministic, no API cost
// ============================================================

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
  failed: string[]; // human-readable failure reasons
  metrics: {
    wordCount: number;
    linkCount: number;
    linkDensity: number;
    imageCount: number;
  };
};

const WORD_RE = /\b[\p{L}\p{N}'’-]+\b/gu;

function countWords(s: string): number {
  if (!s) return 0;
  // Strip tags first so HTML attribute names don't count as words.
  const stripped = s.replace(/<[^>]+>/g, " ");
  const m = stripped.match(WORD_RE);
  return m ? m.length : 0;
}

function countAttrs(s: string, tag: string): number {
  if (!s) return 0;
  const re = new RegExp(`<${tag}\\b`, "gi");
  const m = s.match(re);
  return m ? m.length : 0;
}

function countContentLinks(s: string): number {
  if (!s) return 0;
  const re = /<a\b([^>]*)>/gi;
  let count = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(s))) {
    const href = (match[1] ?? "").match(
      /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i,
    );
    const value = (href?.[1] ?? href?.[2] ?? href?.[3] ?? "").trim();
    if (!value || value.startsWith("#")) continue;
    count++;
  }
  return count;
}

export function scoreHeuristics(post: Post, config: HeuristicConfig = {}): HeuristicResult {
  const min = config.minWordCount ?? 500;
  const max = config.maxWordCount ?? 12000;
  const maxLinkDensity = config.maxLinkDensity ?? Number.POSITIVE_INFINITY;
  const banned = (config.bannedTerms ?? []).map((s) => s.toLowerCase());
  const maxImages = config.maxImages ?? 20;

  const wordCount = countWords(post.html || "");
  const linkCount = countContentLinks(post.html || "");
  const imageCount = countAttrs(post.html || "", "img");
  const linkDensity = wordCount > 0 ? (linkCount / wordCount) * 100 : 0;

  const failed: string[] = [];
  if (wordCount < min) failed.push(`word count ${wordCount} below ${min}`);
  if (wordCount > max) failed.push(`word count ${wordCount} above ${max}`);
  if (linkDensity > maxLinkDensity) {
    failed.push(`link density ${linkDensity.toFixed(2)}% above ${maxLinkDensity}%`);
  }
  if (imageCount > maxImages) {
    failed.push(`image count ${imageCount} above ${maxImages}`);
  }
  if (banned.length > 0) {
    const haystack = `${post.title} ${post.html}`.toLowerCase();
    for (const term of banned) {
      if (haystack.includes(term)) {
        failed.push(`contains banned term: ${term}`);
        break; // one is enough; don't enumerate every match
      }
    }
  }

  return {
    pass: failed.length === 0,
    failed,
    metrics: { wordCount, linkCount, linkDensity, imageCount },
  };
}

// ============================================================
// Niche match — loose by design
// ============================================================
//
// Match is case-insensitive partial-word overlap: any element of
// `post.tags` (or `post.categories`) that contains an allowed niche,
// or vice-versa, counts as a match. Empty `allowedNiches` = accept
// anything ("the network is still open"). This errs toward letting
// content through; tightening to exact match is a one-line config
// change in the host.

export function nicheMatches(
  post: Post,
  allowedNiches: string[],
): { pass: boolean; matched: string[] } {
  if (allowedNiches.length === 0) {
    return { pass: true, matched: [] };
  }
  const allowed = allowedNiches.map((s) => s.toLowerCase().trim()).filter(Boolean);
  const incoming = [...post.tags, ...post.categories]
    .map((s) => s.toLowerCase().trim())
    .filter(Boolean);
  const matched: string[] = [];
  for (const a of allowed) {
    for (const i of incoming) {
      if (a === i || a.includes(i) || i.includes(a)) {
        matched.push(a);
        break;
      }
    }
  }
  return { pass: matched.length > 0, matched };
}

// ============================================================
// LLM quality score
// ============================================================
//
// Rates the post 0-10 on technical depth + originality + readability +
// niche relevance, through @profullstack/ai-providers: c0mpute (our own
// peer network) first, OpenAI and Anthropic only as fallbacks when a
// paid key is set. The caller decides the threshold.
//
// Designed to fail OPEN - if every provider errors we return
// { ok: false, score: null } so the caller can decide whether to
// accept-on-error (most blogs) or reject-on-error (paranoid mode).
// This module never throws.

export type QualityScore = {
  ok: boolean;
  score: number | null; // 0-10
  reasons: string[];
  error?: string;
  /** Which provider answered: "c0mpute", "openai" or "anthropic". */
  provider?: string;
  /** The model that answered. */
  model?: string;
};

export type ScoreQualityInput = {
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
export type AiRouterLike = {
  generateObject(req: Record<string, unknown>): Promise<{
    object: unknown;
    provider: string;
    model: string;
  }>;
};

const DEFAULT_TIMEOUT_MS = 120_000;

/** Shown to the model so a small peer node answers the right shape. */
const SCORE_SCHEMA = {
  type: "object",
  properties: {
    score: { type: "integer", minimum: 0, maximum: 10 },
    reasons: { type: "array", items: { type: "string" }, maxItems: 3 },
  },
  required: ["score"],
} as const;

function buildScorePrompt(post: Post, niche?: string | string[]): string {
  const nicheStr = Array.isArray(niche) ? niche.join(", ") : niche;
  return [
    "Rate the following blog post on a 0–10 scale. Use this rubric:",
    "  10 = expert technical writing with novel insight",
    "   7 = solid, useful, no obvious filler",
    "   5 = competent but unremarkable",
    "   3 = thin, generic, marketing-fluff",
    "   0 = spam / nonsense / off-topic",
    "Consider: technical depth, originality, readability, structure, and signal-to-noise.",
    nicheStr ? `Niche context (relevance counts toward the score): ${nicheStr}.` : "",
    "",
    "Return ONLY a JSON object: {\"score\": <int 0..10>, \"reasons\": [<short string>, ...]}.",
    "Reasons must be terse — 1–8 words each, max 3 reasons.",
    "",
    "--- BEGIN POST ---",
    `TITLE: ${post.title}`,
    post.excerpt ? `EXCERPT: ${post.excerpt}` : "",
    "",
    post.markdown || post.html,
    "--- END POST ---",
  ]
    .filter(Boolean)
    .join("\n");
}

function clamp(n: unknown, lo: number, hi: number): number | null {
  if (typeof n !== "number" || !Number.isFinite(n)) return null;
  return Math.max(lo, Math.min(hi, Math.round(n)));
}

export async function scoreQuality(input: ScoreQualityInput): Promise<QualityScore> {
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  try {
    const ai =
      input.ai ??
      (createAiProviders({
        ...(input.fetchImpl
          ? {
              c0mpute: { fetch: input.fetchImpl },
              openai: { fetch: input.fetchImpl },
              anthropic: { fetch: input.fetchImpl },
            }
          : {}),
        ...(input.openaiApiKey ? { openai: { apiKey: input.openaiApiKey } } : {}),
        ...(input.anthropicApiKey
          ? { anthropic: { apiKey: input.anthropicApiKey, ...(input.model ? { model: input.model } : {}) } }
          : {}),
      }) as unknown as AiRouterLike);

    const res = await ai.generateObject({
      system: "You rate blog posts. You answer with one JSON object and nothing else.",
      user: buildScorePrompt(input.post, input.niche),
      name: "QualityScore",
      jsonSchema: SCORE_SCHEMA,
      maxTokens: 300,
      temperature: 0,
      feature: "autoblog.scoreQuality",
      timeoutMs,
    });

    const obj = (res.object ?? {}) as { score?: unknown; reasons?: unknown };
    const score = clamp(obj.score, 0, 10);
    const reasons = Array.isArray(obj.reasons)
      ? obj.reasons.filter((r): r is string => typeof r === "string").slice(0, 5)
      : [];
    if (score === null) {
      return { ok: false, score: null, reasons, error: "score field missing or not a number" };
    }
    return { ok: true, score, reasons, provider: res.provider, model: res.model };
  } catch (err) {
    return {
      ok: false,
      score: null,
      reasons: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ============================================================
// Combined gate
// ============================================================

export type GateConfig = {
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

export type GateOutcome =
  | { ok: true; metrics: HeuristicResult["metrics"]; quality?: QualityScore }
  | {
      ok: false;
      stage: "heuristic" | "niche" | "quality";
      reasons: string[];
      metrics?: HeuristicResult["metrics"];
      quality?: QualityScore;
    };

export async function gatePost(post: Post, config: GateConfig): Promise<GateOutcome> {
  // 1. Heuristics.
  const heur = scoreHeuristics(post, config.heuristics ?? {});
  if (!heur.pass) {
    return { ok: false, stage: "heuristic", reasons: heur.failed, metrics: heur.metrics };
  }

  // 2. Niche.
  const niche = nicheMatches(post, config.allowedNiches ?? []);
  if (!niche.pass) {
    return {
      ok: false,
      stage: "niche",
      reasons: [
        `no niche overlap; allowed=${(config.allowedNiches ?? []).join(",")} incoming=${[...post.tags, ...post.categories].join(",")}`,
      ],
      metrics: heur.metrics,
    };
  }

  // 3. Quality (optional).
  if (config.minQualityScore !== undefined) {
    const q = await scoreQuality({
      post,
      niche: config.allowedNiches,
      ...(config.anthropicApiKey ? { anthropicApiKey: config.anthropicApiKey } : {}),
      ...(config.openaiApiKey ? { openaiApiKey: config.openaiApiKey } : {}),
    });
    if (!q.ok) {
      if (config.failOpenOnLlmError !== false) {
        return { ok: true, metrics: heur.metrics, quality: q };
      }
      return {
        ok: false,
        stage: "quality",
        reasons: [`LLM call failed: ${q.error}`],
        metrics: heur.metrics,
        quality: q,
      };
    }
    if (q.score! < config.minQualityScore) {
      return {
        ok: false,
        stage: "quality",
        reasons: [
          `score ${q.score} below threshold ${config.minQualityScore}`,
          ...q.reasons,
        ],
        metrics: heur.metrics,
        quality: q,
      };
    }
    return { ok: true, metrics: heur.metrics, quality: q };
  }

  return { ok: true, metrics: heur.metrics };
}
