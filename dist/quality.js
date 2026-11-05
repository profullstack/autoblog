// src/quality.ts
import { createAiProviders } from "@profullstack/ai-providers";
var WORD_RE = /\b[\p{L}\p{N}'’-]+\b/gu;
function countWords(s) {
  if (!s) return 0;
  const stripped = s.replace(/<[^>]+>/g, " ");
  const m = stripped.match(WORD_RE);
  return m ? m.length : 0;
}
function countAttrs(s, tag) {
  if (!s) return 0;
  const re = new RegExp(`<${tag}\\b`, "gi");
  const m = s.match(re);
  return m ? m.length : 0;
}
function countContentLinks(s) {
  if (!s) return 0;
  const re = /<a\b([^>]*)>/gi;
  let count = 0;
  let match;
  while (match = re.exec(s)) {
    const href = (match[1] ?? "").match(
      /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i
    );
    const value = (href?.[1] ?? href?.[2] ?? href?.[3] ?? "").trim();
    if (!value || value.startsWith("#")) continue;
    count++;
  }
  return count;
}
function scoreHeuristics(post, config = {}) {
  const min = config.minWordCount ?? 500;
  const max = config.maxWordCount ?? 12e3;
  const maxLinkDensity = config.maxLinkDensity ?? Number.POSITIVE_INFINITY;
  const banned = (config.bannedTerms ?? []).map((s) => s.toLowerCase());
  const maxImages = config.maxImages ?? 20;
  const wordCount = countWords(post.html || "");
  const linkCount = countContentLinks(post.html || "");
  const imageCount = countAttrs(post.html || "", "img");
  const linkDensity = wordCount > 0 ? linkCount / wordCount * 100 : 0;
  const failed = [];
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
        break;
      }
    }
  }
  return {
    pass: failed.length === 0,
    failed,
    metrics: { wordCount, linkCount, linkDensity, imageCount }
  };
}
function nicheMatches(post, allowedNiches) {
  if (allowedNiches.length === 0) {
    return { pass: true, matched: [] };
  }
  const allowed = allowedNiches.map((s) => s.toLowerCase().trim()).filter(Boolean);
  const incoming = [...post.tags, ...post.categories].map((s) => s.toLowerCase().trim()).filter(Boolean);
  const matched = [];
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
var DEFAULT_TIMEOUT_MS = 12e4;
var SCORE_SCHEMA = {
  type: "object",
  properties: {
    score: { type: "integer", minimum: 0, maximum: 10 },
    reasons: { type: "array", items: { type: "string" }, maxItems: 3 }
  },
  required: ["score"]
};
function buildScorePrompt(post, niche) {
  const nicheStr = Array.isArray(niche) ? niche.join(", ") : niche;
  return [
    "Rate the following blog post on a 0\u201310 scale. Use this rubric:",
    "  10 = expert technical writing with novel insight",
    "   7 = solid, useful, no obvious filler",
    "   5 = competent but unremarkable",
    "   3 = thin, generic, marketing-fluff",
    "   0 = spam / nonsense / off-topic",
    "Consider: technical depth, originality, readability, structure, and signal-to-noise.",
    nicheStr ? `Niche context (relevance counts toward the score): ${nicheStr}.` : "",
    "",
    'Return ONLY a JSON object: {"score": <int 0..10>, "reasons": [<short string>, ...]}.',
    "Reasons must be terse \u2014 1\u20138 words each, max 3 reasons.",
    "",
    "--- BEGIN POST ---",
    `TITLE: ${post.title}`,
    post.excerpt ? `EXCERPT: ${post.excerpt}` : "",
    "",
    post.markdown || post.html,
    "--- END POST ---"
  ].filter(Boolean).join("\n");
}
function clamp(n, lo, hi) {
  if (typeof n !== "number" || !Number.isFinite(n)) return null;
  return Math.max(lo, Math.min(hi, Math.round(n)));
}
async function scoreQuality(input) {
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  try {
    const ai = input.ai ?? createAiProviders({
      ...input.fetchImpl ? {
        c0mpute: { fetch: input.fetchImpl },
        openai: { fetch: input.fetchImpl },
        anthropic: { fetch: input.fetchImpl }
      } : {},
      ...input.openaiApiKey ? { openai: { apiKey: input.openaiApiKey } } : {},
      ...input.anthropicApiKey ? { anthropic: { apiKey: input.anthropicApiKey, ...input.model ? { model: input.model } : {} } } : {}
    });
    const res = await ai.generateObject({
      system: "You rate blog posts. You answer with one JSON object and nothing else.",
      user: buildScorePrompt(input.post, input.niche),
      name: "QualityScore",
      jsonSchema: SCORE_SCHEMA,
      maxTokens: 300,
      temperature: 0,
      feature: "autoblog.scoreQuality",
      timeoutMs
    });
    const obj = res.object ?? {};
    const score = clamp(obj.score, 0, 10);
    const reasons = Array.isArray(obj.reasons) ? obj.reasons.filter((r) => typeof r === "string").slice(0, 5) : [];
    if (score === null) {
      return { ok: false, score: null, reasons, error: "score field missing or not a number" };
    }
    return { ok: true, score, reasons, provider: res.provider, model: res.model };
  } catch (err) {
    return {
      ok: false,
      score: null,
      reasons: [],
      error: err instanceof Error ? err.message : String(err)
    };
  }
}
async function gatePost(post, config) {
  const heur = scoreHeuristics(post, config.heuristics ?? {});
  if (!heur.pass) {
    return { ok: false, stage: "heuristic", reasons: heur.failed, metrics: heur.metrics };
  }
  const niche = nicheMatches(post, config.allowedNiches ?? []);
  if (!niche.pass) {
    return {
      ok: false,
      stage: "niche",
      reasons: [
        `no niche overlap; allowed=${(config.allowedNiches ?? []).join(",")} incoming=${[...post.tags, ...post.categories].join(",")}`
      ],
      metrics: heur.metrics
    };
  }
  if (config.minQualityScore !== void 0) {
    const q = await scoreQuality({
      post,
      niche: config.allowedNiches,
      ...config.anthropicApiKey ? { anthropicApiKey: config.anthropicApiKey } : {},
      ...config.openaiApiKey ? { openaiApiKey: config.openaiApiKey } : {}
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
        quality: q
      };
    }
    if (q.score < config.minQualityScore) {
      return {
        ok: false,
        stage: "quality",
        reasons: [
          `score ${q.score} below threshold ${config.minQualityScore}`,
          ...q.reasons
        ],
        metrics: heur.metrics,
        quality: q
      };
    }
    return { ok: true, metrics: heur.metrics, quality: q };
  }
  return { ok: true, metrics: heur.metrics };
}
export {
  gatePost,
  nicheMatches,
  scoreHeuristics,
  scoreQuality
};
//# sourceMappingURL=quality.js.map