// W3C Micropub server helpers (https://www.w3.org/TR/micropub/).
//
// Micropub is an inbound publishing API — clients (Quill, Indigenous,
// custom scripts) POST a new entry; the server creates a post and
// returns 201 with a Location header.
//
// What this module gives you:
//   - parseMicropubBody({ contentType, body }) → MicropubEntry
//     Handles both form-urlencoded and JSON microformats2 shapes.
//   - createMicropubHandler({ verify, onCreate, onUpdate?, onDelete? })
//     Returns a request → response function (host-agnostic) you wire
//     into any HTTP framework.
//
// IndieAuth verification is the caller's job — pass a verify(token)
// function that resolves to an authenticated identity. The SDK doesn't
// ship an IndieAuth client because there are many valid implementations
// (your own /token endpoint, indieauth.com, a hosted IDP).
function asArray(v) {
    if (v === undefined)
        return [];
    return Array.isArray(v) ? v : [v];
}
function firstString(v) {
    if (typeof v === "string")
        return v;
    if (Array.isArray(v) && typeof v[0] === "string")
        return v[0];
    return undefined;
}
function parseFormBody(body) {
    return new URLSearchParams(body);
}
function parseFormEntry(params) {
    const action = params.get("action");
    const url = params.get("url");
    if (action === "delete" && url)
        return { action: "delete", url };
    if (action === "undelete" && url)
        return { action: "undelete", url };
    if (action === "update" && url) {
        return { action: "update", url };
    }
    // Default: create.
    const h = params.get("h") ?? "entry";
    if (h !== "entry") {
        throw new Error(`unsupported h-type: ${h}`);
    }
    const categories = [];
    for (const [k, v] of params) {
        if (k === "category" || k === "category[]")
            categories.push(v);
    }
    const photos = [];
    for (const [k, v] of params) {
        if (k === "photo" || k === "photo[]")
            photos.push(v);
    }
    const entry = {
        type: "h-entry",
        name: params.get("name") ?? undefined,
        content: params.get("content") ?? undefined,
        summary: params.get("summary") ?? undefined,
        category: categories.length ? categories : undefined,
        published: params.get("published") ?? undefined,
        slug: params.get("mp-slug") ?? undefined,
        status: params.get("post-status") === "draft" ? "draft" : params.get("post-status") === "published" ? "published" : undefined,
        photo: photos.length ? photos : undefined,
        extras: {},
    };
    // Stash anything unrecognized.
    const known = new Set([
        "h", "name", "content", "summary", "published", "mp-slug", "post-status",
        "category", "category[]", "photo", "photo[]", "action", "url",
    ]);
    for (const [k, v] of params) {
        if (!known.has(k))
            entry.extras[k] = v;
    }
    return { action: "create", entry };
}
function parseJsonEntry(payload) {
    if (payload?.action === "delete" && typeof payload.url === "string") {
        return { action: "delete", url: payload.url };
    }
    if (payload?.action === "undelete" && typeof payload.url === "string") {
        return { action: "undelete", url: payload.url };
    }
    if (payload?.action === "update" && typeof payload.url === "string") {
        return {
            action: "update",
            url: payload.url,
            replace: payload.replace,
            add: payload.add,
            delete: payload.delete,
        };
    }
    // Create — must have type starting with h-* (h-entry by default).
    const types = Array.isArray(payload?.type) ? payload.type : [];
    if (!types.includes("h-entry")) {
        throw new Error("only h-entry creates are supported");
    }
    const props = (payload?.properties ?? {});
    const entry = {
        type: "h-entry",
        name: firstString(props.name),
        content: (() => {
            const c = props.content?.[0];
            if (typeof c === "string")
                return c;
            // microformats2 allows { html, value }.
            if (c && typeof c === "object" && "html" in c) {
                return String(c.html);
            }
            return undefined;
        })(),
        summary: firstString(props.summary),
        category: asArray(props.category).filter((c) => typeof c === "string"),
        published: firstString(props.published),
        slug: firstString(props["mp-slug"]),
        status: (() => {
            const s = firstString(props["post-status"]);
            if (s === "draft" || s === "published")
                return s;
            return undefined;
        })(),
        photo: asArray(props.photo).filter((p) => typeof p === "string"),
        extras: {},
    };
    for (const k of Object.keys(props)) {
        if (![
            "name", "content", "summary", "category", "published",
            "mp-slug", "post-status", "photo",
        ].includes(k)) {
            entry.extras[k] = props[k];
        }
    }
    if (entry.category && entry.category.length === 0)
        entry.category = undefined;
    if (entry.photo && entry.photo.length === 0)
        entry.photo = undefined;
    return { action: "create", entry };
}
export function parseMicropubBody(input) {
    const ct = (input.contentType ?? "").toLowerCase();
    if (ct.includes("application/json")) {
        let payload;
        try {
            payload = JSON.parse(input.body);
        }
        catch {
            throw new Error("invalid JSON");
        }
        return parseJsonEntry(payload);
    }
    if (ct.includes("application/x-www-form-urlencoded") || ct === "") {
        return parseFormEntry(parseFormBody(input.body));
    }
    throw new Error(`unsupported content-type: ${ct}`);
}
function err(status, error, description) {
    return {
        status,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(description
            ? { error, error_description: description }
            : { error }),
    };
}
export function createMicropubHandler(opts) {
    return async (req) => {
        if (req.method.toUpperCase() !== "POST") {
            return err(405, "invalid_request", "POST only");
        }
        const authHeader = (() => {
            for (const k of Object.keys(req.headers)) {
                if (k.toLowerCase() === "authorization") {
                    const v = req.headers[k];
                    if (Array.isArray(v))
                        return v[0] ?? null;
                    return v ?? null;
                }
            }
            return null;
        })();
        const token = (authHeader ?? "").replace(/^Bearer\s+/i, "").trim();
        if (!token)
            return err(401, "unauthorized", "missing bearer");
        const v = await opts.verify(token);
        if (!v.ok)
            return err(403, "forbidden", v.reason);
        const ct = (() => {
            for (const k of Object.keys(req.headers)) {
                if (k.toLowerCase() === "content-type") {
                    const val = req.headers[k];
                    if (Array.isArray(val))
                        return val[0] ?? null;
                    return val ?? null;
                }
            }
            return null;
        })();
        let parsed;
        try {
            parsed = parseMicropubBody({ contentType: ct, body: req.body });
        }
        catch (e) {
            return err(400, "invalid_request", e instanceof Error ? e.message : "parse failed");
        }
        if (parsed.action === "delete") {
            if (!opts.onDelete)
                return err(400, "invalid_request", "delete not supported");
            await opts.onDelete(parsed.url);
            return { status: 204, headers: {}, body: "" };
        }
        if (parsed.action === "undelete") {
            if (!opts.onUndelete)
                return err(400, "invalid_request", "undelete not supported");
            await opts.onUndelete(parsed.url);
            return { status: 204, headers: {}, body: "" };
        }
        if (parsed.action === "update") {
            if (!opts.onUpdate)
                return err(400, "invalid_request", "update not supported");
            await opts.onUpdate(parsed);
            return { status: 204, headers: {}, body: "" };
        }
        // Create.
        const result = await opts.onCreate(parsed.entry, { me: v.me, scope: v.scope });
        return {
            status: 201,
            headers: { location: result.url },
            body: "",
        };
    };
}
//# sourceMappingURL=micropub.js.map