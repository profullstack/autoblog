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

export function scoreHeuristics(post: Post, config: HeuristicConfig = {}): HeuristicResult {
  const min = config.minWordCount ?? 500;
  const max = config.maxWordCount ?? 12000;
  const maxLinkDensity = config.maxLinkDensity ?? 1.0;
  const banned = (config.bannedTerms ?? []).map((s) => s.toLowerCase());
  const maxImages = config.maxImages ?? 20;

  const wordCount = countWords(post.html || "");
  const linkCount = countAttrs(post.html || "", "a");
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
// Calls Anthropic's Messages API to rate the post 0–10 on technical
// depth + originality + readability + niche relevance. Costs about
// $0.002 per post on Haiku 4.5. The caller decides the threshold.
//
// Designed to fail OPEN — if the call errors or the API key is
// missing, we return { ok: false, score: null } so the caller can
// decide whether to accept-on-error (most blogs) or reject-on-error
// (paranoid mode). This module never throws.

export type QualityScore = {
  ok: boolean;
  score: number | null; // 0–10
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

const DEFAULT_MODEL = "claude-haiku-4-5-20251001";

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
  const fetchImpl = input.fetchImpl ?? fetch;
  const model = input.model ?? DEFAULT_MODEL;
  const timeoutMs = input.timeoutMs ?? 15_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": input.anthropicApiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        max_tokens: 200,
        messages: [
          { role: "user", content: buildScorePrompt(input.post, input.niche) },
        ],
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { ok: false, score: null, reasons: [], error: `HTTP ${res.status}: ${text.slice(0, 200)}` };
    }
    const data = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
    const text = data.content?.find((c) => c.type === "text")?.text ?? "";
    // Be forgiving — the model might wrap in code fences.
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) {
      return { ok: false, score: null, reasons: [], error: "no JSON in response" };
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(match[0]);
    } catch (err) {
      return { ok: false, score: null, reasons: [], error: `bad JSON: ${(err as Error).message}` };
    }
    const obj = parsed as { score?: unknown; reasons?: unknown };
    const score = clamp(obj.score, 0, 10);
    const reasons = Array.isArray(obj.reasons)
      ? obj.reasons.filter((r): r is string => typeof r === "string").slice(0, 5)
      : [];
    if (score === null) {
      return { ok: false, score: null, reasons, error: "score field missing or not a number" };
    }
    return { ok: true, score, reasons };
  } catch (err) {
    return {
      ok: false,
      score: null,
      reasons: [],
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    clearTimeout(timer);
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
  /** Anthropic API key for the LLM gate. Required iff minQualityScore is set. */
  anthropicApiKey?: string;
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
  if (config.minQualityScore !== undefined && config.anthropicApiKey) {
    const q = await scoreQuality({
      post,
      niche: config.allowedNiches,
      anthropicApiKey: config.anthropicApiKey,
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
