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
const WORD_RE = /\b[\p{L}\p{N}'’-]+\b/gu;
function countWords(s) {
    if (!s)
        return 0;
    // Strip tags first so HTML attribute names don't count as words.
    const stripped = s.replace(/<[^>]+>/g, " ");
    const m = stripped.match(WORD_RE);
    return m ? m.length : 0;
}
function countAttrs(s, tag) {
    if (!s)
        return 0;
    const re = new RegExp(`<${tag}\\b`, "gi");
    const m = s.match(re);
    return m ? m.length : 0;
}
export function scoreHeuristics(post, config = {}) {
    const min = config.minWordCount ?? 500;
    const max = config.maxWordCount ?? 12000;
    const maxLinkDensity = config.maxLinkDensity ?? 1.0;
    const banned = (config.bannedTerms ?? []).map((s) => s.toLowerCase());
    const maxImages = config.maxImages ?? 20;
    const wordCount = countWords(post.html || "");
    const linkCount = countAttrs(post.html || "", "a");
    const imageCount = countAttrs(post.html || "", "img");
    const linkDensity = wordCount > 0 ? (linkCount / wordCount) * 100 : 0;
    const failed = [];
    if (wordCount < min)
        failed.push(`word count ${wordCount} below ${min}`);
    if (wordCount > max)
        failed.push(`word count ${wordCount} above ${max}`);
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
export function nicheMatches(post, allowedNiches) {
    if (allowedNiches.length === 0) {
        return { pass: true, matched: [] };
    }
    const allowed = allowedNiches.map((s) => s.toLowerCase().trim()).filter(Boolean);
    const incoming = [...post.tags, ...post.categories]
        .map((s) => s.toLowerCase().trim())
        .filter(Boolean);
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
const DEFAULT_MODEL = "claude-haiku-4-5-20251001";
function buildScorePrompt(post, niche) {
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
function clamp(n, lo, hi) {
    if (typeof n !== "number" || !Number.isFinite(n))
        return null;
    return Math.max(lo, Math.min(hi, Math.round(n)));
}
export async function scoreQuality(input) {
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
        const data = (await res.json());
        const text = data.content?.find((c) => c.type === "text")?.text ?? "";
        // Be forgiving — the model might wrap in code fences.
        const match = text.match(/\{[\s\S]*\}/);
        if (!match) {
            return { ok: false, score: null, reasons: [], error: "no JSON in response" };
        }
        let parsed;
        try {
            parsed = JSON.parse(match[0]);
        }
        catch (err) {
            return { ok: false, score: null, reasons: [], error: `bad JSON: ${err.message}` };
        }
        const obj = parsed;
        const score = clamp(obj.score, 0, 10);
        const reasons = Array.isArray(obj.reasons)
            ? obj.reasons.filter((r) => typeof r === "string").slice(0, 5)
            : [];
        if (score === null) {
            return { ok: false, score: null, reasons, error: "score field missing or not a number" };
        }
        return { ok: true, score, reasons };
    }
    catch (err) {
        return {
            ok: false,
            score: null,
            reasons: [],
            error: err instanceof Error ? err.message : String(err),
        };
    }
    finally {
        clearTimeout(timer);
    }
}
export async function gatePost(post, config) {
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
        if (q.score < config.minQualityScore) {
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
//# sourceMappingURL=quality.js.map