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

export type MicropubEntry = {
  // Subset of microformats2 h-entry properties we normalize.
  type: "h-entry";
  name?: string; // post title
  content?: string; // body (plain or HTML)
  summary?: string;
  category?: string[]; // tags
  published?: string; // ISO datetime
  slug?: string; // mp-slug
  status?: "published" | "draft";
  photo?: string[]; // image URLs
  // Anything we don't recognize stays in `extras` so the receiver
  // can salvage it.
  extras: Record<string, unknown>;
};

export type MicropubAction = "create" | "update" | "delete" | "undelete";

export type MicropubRequest =
  | { action: "create"; entry: MicropubEntry }
  | { action: "update"; url: string; replace?: Record<string, unknown[]>; add?: Record<string, unknown[]>; delete?: string[] | Record<string, unknown[]> }
  | { action: "delete"; url: string }
  | { action: "undelete"; url: string };

function asArray<T>(v: T | T[] | undefined): T[] {
  if (v === undefined) return [];
  return Array.isArray(v) ? v : [v];
}

function firstString(v: unknown): string | undefined {
  if (typeof v === "string") return v;
  if (Array.isArray(v) && typeof v[0] === "string") return v[0];
  return undefined;
}

function parseFormBody(body: string): URLSearchParams {
  return new URLSearchParams(body);
}

function parseFormEntry(params: URLSearchParams): MicropubRequest {
  const action = params.get("action");
  const url = params.get("url");
  if (action === "delete" && url) return { action: "delete", url };
  if (action === "undelete" && url) return { action: "undelete", url };
  if (action === "update" && url) {
    return { action: "update", url };
  }

  // Default: create.
  const h = params.get("h") ?? "entry";
  if (h !== "entry") {
    throw new Error(`unsupported h-type: ${h}`);
  }
  const categories: string[] = [];
  for (const [k, v] of params) {
    if (k === "category" || k === "category[]") categories.push(v);
  }
  const photos: string[] = [];
  for (const [k, v] of params) {
    if (k === "photo" || k === "photo[]") photos.push(v);
  }

  const entry: MicropubEntry = {
    type: "h-entry",
    name: params.get("name") ?? undefined,
    content: params.get("content") ?? undefined,
    summary: params.get("summary") ?? undefined,
    category: categories.length ? categories : undefined,
    published: params.get("published") ?? undefined,
    slug: params.get("mp-slug") ?? undefined,
    status:
      params.get("post-status") === "draft" ? "draft" : params.get("post-status") === "published" ? "published" : undefined,
    photo: photos.length ? photos : undefined,
    extras: {},
  };
  // Stash anything unrecognized.
  const known = new Set([
    "h", "name", "content", "summary", "published", "mp-slug", "post-status",
    "category", "category[]", "photo", "photo[]", "action", "url",
  ]);
  for (const [k, v] of params) {
    if (!known.has(k)) entry.extras[k] = v;
  }
  return { action: "create", entry };
}

function parseJsonEntry(payload: any): MicropubRequest {
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
  const types: string[] = Array.isArray(payload?.type) ? payload.type : [];
  if (!types.includes("h-entry")) {
    throw new Error("only h-entry creates are supported");
  }
  const props = (payload?.properties ?? {}) as Record<string, unknown[]>;
  const entry: MicropubEntry = {
    type: "h-entry",
    name: firstString(props.name),
    content: (() => {
      const c = props.content?.[0];
      if (typeof c === "string") return c;
      // microformats2 allows { html, value }.
      if (c && typeof c === "object" && "html" in (c as any)) {
        return String((c as any).html);
      }
      return undefined;
    })(),
    summary: firstString(props.summary),
    category: asArray(props.category).filter((c): c is string => typeof c === "string"),
    published: firstString(props.published),
    slug: firstString(props["mp-slug"]),
    status: (() => {
      const s = firstString(props["post-status"]);
      if (s === "draft" || s === "published") return s;
      return undefined;
    })(),
    photo: asArray(props.photo).filter((p): p is string => typeof p === "string"),
    extras: {},
  };
  for (const k of Object.keys(props)) {
    if (
      ![
        "name", "content", "summary", "category", "published",
        "mp-slug", "post-status", "photo",
      ].includes(k)
    ) {
      entry.extras[k] = props[k];
    }
  }
  if (entry.category && entry.category.length === 0) entry.category = undefined;
  if (entry.photo && entry.photo.length === 0) entry.photo = undefined;
  return { action: "create", entry };
}

export function parseMicropubBody(input: {
  contentType: string | null | undefined;
  body: string;
}): MicropubRequest {
  const ct = (input.contentType ?? "").toLowerCase();
  if (ct.includes("application/json")) {
    let payload: unknown;
    try {
      payload = JSON.parse(input.body);
    } catch {
      throw new Error("invalid JSON");
    }
    return parseJsonEntry(payload);
  }
  if (ct.includes("application/x-www-form-urlencoded") || ct === "") {
    return parseFormEntry(parseFormBody(input.body));
  }
  throw new Error(`unsupported content-type: ${ct}`);
}

// ------------------------------------------------------------
// Server handler
// ------------------------------------------------------------

export type MicropubVerifyResult =
  | { ok: true; me: string; scope?: string[] }
  | { ok: false; reason: string };

export type MicropubCreateResult = {
  url: string; // canonical URL of the created post — goes into Location:
};

export type MicropubHandlerOpts = {
  /** Verify the bearer (typically an IndieAuth token). */
  verify: (token: string) => Promise<MicropubVerifyResult> | MicropubVerifyResult;
  /** Persist a created entry. Must return the post's public URL. */
  onCreate: (
    entry: MicropubEntry,
    identity: { me: string; scope?: string[] },
  ) => Promise<MicropubCreateResult>;
  /** Optional update handler. */
  onUpdate?: (req: Extract<MicropubRequest, { action: "update" }>) => Promise<void>;
  /** Optional delete handler. */
  onDelete?: (url: string) => Promise<void>;
  /** Optional undelete handler. */
  onUndelete?: (url: string) => Promise<void>;
};

export type HandlerResponse = {
  status: number;
  headers: Record<string, string>;
  body: string;
};

function err(status: number, error: string, description?: string): HandlerResponse {
  return {
    status,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(
      description
        ? { error, error_description: description }
        : { error },
    ),
  };
}

export function createMicropubHandler(opts: MicropubHandlerOpts) {
  return async (req: {
    method: string;
    headers: Record<string, string | string[] | undefined>;
    body: string;
  }): Promise<HandlerResponse> => {
    if (req.method.toUpperCase() !== "POST") {
      return err(405, "invalid_request", "POST only");
    }
    const authHeader = ((): string | null => {
      for (const k of Object.keys(req.headers)) {
        if (k.toLowerCase() === "authorization") {
          const v = req.headers[k];
          if (Array.isArray(v)) return v[0] ?? null;
          return v ?? null;
        }
      }
      return null;
    })();
    const token = (authHeader ?? "").replace(/^Bearer\s+/i, "").trim();
    if (!token) return err(401, "unauthorized", "missing bearer");
    const v = await opts.verify(token);
    if (!v.ok) return err(403, "forbidden", v.reason);

    const ct = (() => {
      for (const k of Object.keys(req.headers)) {
        if (k.toLowerCase() === "content-type") {
          const val = req.headers[k];
          if (Array.isArray(val)) return val[0] ?? null;
          return val ?? null;
        }
      }
      return null;
    })();

    let parsed: MicropubRequest;
    try {
      parsed = parseMicropubBody({ contentType: ct, body: req.body });
    } catch (e) {
      return err(400, "invalid_request", e instanceof Error ? e.message : "parse failed");
    }

    if (parsed.action === "delete") {
      if (!opts.onDelete) return err(400, "invalid_request", "delete not supported");
      await opts.onDelete(parsed.url);
      return { status: 204, headers: {}, body: "" };
    }
    if (parsed.action === "undelete") {
      if (!opts.onUndelete) return err(400, "invalid_request", "undelete not supported");
      await opts.onUndelete(parsed.url);
      return { status: 204, headers: {}, body: "" };
    }
    if (parsed.action === "update") {
      if (!opts.onUpdate) return err(400, "invalid_request", "update not supported");
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
