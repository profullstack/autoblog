"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/quality.ts
var quality_exports = {};
__export(quality_exports, {
  gatePost: () => gatePost,
  nicheMatches: () => nicheMatches,
  scoreHeuristics: () => scoreHeuristics,
  scoreQuality: () => scoreQuality
});
module.exports = __toCommonJS(quality_exports);
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
function scoreHeuristics(post, config = {}) {
  const min = config.minWordCount ?? 500;
  const max = config.maxWordCount ?? 12e3;
  const maxLinkDensity = config.maxLinkDensity ?? 1;
  const banned = (config.bannedTerms ?? []).map((s) => s.toLowerCase());
  const maxImages = config.maxImages ?? 20;
  const wordCount = countWords(post.html || "");
  const linkCount = countAttrs(post.html || "", "a");
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
var DEFAULT_MODEL = "claude-haiku-4-5-20251001";
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
  const fetchImpl = input.fetchImpl ?? fetch;
  const model = input.model ?? DEFAULT_MODEL;
  const timeoutMs = input.timeoutMs ?? 15e3;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": input.anthropicApiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json"
      },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        max_tokens: 200,
        messages: [
          { role: "user", content: buildScorePrompt(input.post, input.niche) }
        ]
      })
    });
    if (!res.ok) {
      const text2 = await res.text().catch(() => "");
      return { ok: false, score: null, reasons: [], error: `HTTP ${res.status}: ${text2.slice(0, 200)}` };
    }
    const data = await res.json();
    const text = data.content?.find((c) => c.type === "text")?.text ?? "";
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) {
      return { ok: false, score: null, reasons: [], error: "no JSON in response" };
    }
    let parsed;
    try {
      parsed = JSON.parse(match[0]);
    } catch (err) {
      return { ok: false, score: null, reasons: [], error: `bad JSON: ${err.message}` };
    }
    const obj = parsed;
    const score = clamp(obj.score, 0, 10);
    const reasons = Array.isArray(obj.reasons) ? obj.reasons.filter((r) => typeof r === "string").slice(0, 5) : [];
    if (score === null) {
      return { ok: false, score: null, reasons, error: "score field missing or not a number" };
    }
    return { ok: true, score, reasons };
  } catch (err) {
    return {
      ok: false,
      score: null,
      reasons: [],
      error: err instanceof Error ? err.message : String(err)
    };
  } finally {
    clearTimeout(timer);
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
  if (config.minQualityScore !== void 0 && config.anthropicApiKey) {
    const q = await scoreQuality({
      post,
      niche: config.allowedNiches,
      anthropicApiKey: config.anthropicApiKey
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
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  gatePost,
  nicheMatches,
  scoreHeuristics,
  scoreQuality
});
//# sourceMappingURL=quality.cjs.map